const app = require('express')();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const uuid = require('uuid');

const fps = 60;
const maxClientNumber = 20;
const clientNumberOfRoom = 2;
const maxRoomNumber = parseInt(maxClientNumber / clientNumberOfRoom);
const roomStatus = {
    "pending": 0,
    "inProgress": 1
};
const clientStatus = {
    "idle": 0,
    "pending": 1,
    "inProgress": 2,
}

const arena = {
    width: 500,
    height: 200
}

const entity = {
    radius: 20
}

const colors = ['red', 'blue', 'black', 'green']

const getRandomInt = (min, max) => {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

let rooms = [];
let clients = new Map();

for (let i = 0; i < maxRoomNumber; i++) {
    rooms[i] = {
        "roomId": i,
        "status": roomStatus.pending,
        "currentTick": 0,
        "clients": [],
        "actions": []
    };
}

io.on('connection', (socket) => {
    if (clients.size >= maxClientNumber) {
        socket.emit('connectFailed', {"info": "exceeded max client number"});
        socket.disconnect();
    } else {
        clients.set(socket.id, {
            "id": uuid.v4(),
            "roomId": -1,
            "status": clientStatus.idle
        });
        socket.emit('connected', {
            "info": "you've connected",
            "totalClientNumber": clientNumberOfRoom
        });
    }
    socket.on('matching', () => {
        let client = clients.get(socket.id);
        if (client && client.status === clientStatus.idle) {
            let isFound = false;
            for (var i = 0; i < rooms.length; i++) {
                if (rooms[i].clients.length < clientNumberOfRoom) {
                    isFound = true;
                    break;
                }
            }
            if (isFound) {
                socket.join(i);
                let clients = rooms[i].clients;
                clients.push({
                    "id": client.id,
                    "color": colors[clients.length % colors.length],
                    "position": {
                        "x": getRandomInt(entity.radius, arena.width - entity.radius),
                        "y": getRandomInt(entity.radius, arena.height - entity.radius),
                    }
                });
                client.roomId = i;
                client.status = clientStatus.pending;

                io.in(i).emit('clientJoined', {
                    "info": "client: " + client.id + " joined room: " + i,
                    "totalClientNumber": clientNumberOfRoom, 
                    "currentClientNumber": clients.length
                });
            } else {
                socket.emit('matchingFailed', {"info": "no avaliable room"});
            }
        } else {
            socket.emit('matchingFailed', {"info": "invalid client status"});
        }
    });

    socket.on("update", (message) => {
        let client = clients.get(socket.id);
        if (client) {
            let room = rooms[client.roomId];
            if (room && message.hasOwnProperty('tick') && message.tick === room.currentTick) {
                let action = room.actions.find(action => action.id === client.id);
                if (!action && room.actions.length < maxClientNumber) {
                    room.actions.push({
                        'id': client.id,
                        'action': message.hasOwnProperty('action') ? message.action : []
                    });
                }
            }
        }
    });

    socket.on('disconnect', () => {
        let client = clients.get(socket.id);
        if (client) {
            if (client.status !== clientStatus.idle) {
                let room = rooms[client.roomId];
                if (room) {
                    room.clients = room.clients.filter(_client => _client.id !== client.id);
                    socket.to(client.roomId).emit('clientLeft', {
                        "info": "client: " + client.id + " left room: " + client.roomId,
                        "totalClientNumber": clientNumberOfRoom, 
                        "currentClientNumber": room.clients.length
                    });
                }
            }
            clients.delete(socket.id);
        }
    });
});

setInterval(() => {
    rooms.forEach((room, index) => {
        if (room.status === roomStatus.pending && room.clients.length === clientNumberOfRoom) {
            room.status = roomStatus.inProgress;
            io.in(index).emit('start', {
                'clients': room.clients
            });
        }
        if (room.status === roomStatus.inProgress && room.clients.length < clientNumberOfRoom) {
            room.clients = [];
            room.actions = [];
            room.currentTick = 0;
            room.status = roomStatus.pending;
            io.in(index).emit('roomClosed', {"info": "room: " + room.roomId + " closed"});
            io.in(index).clients((error, socketIds) => {
                socketIds.forEach((socketId) => {
                    io.sockets.sockets[socketId].leave(index)
                    let client = clients.get(socketId);
                    if (client) {
                        client.roomId = -1;
                        client.status = clientStatus.idle;
                    }
                });
            });
        }
    });
}, 1000);

setInterval(() => {
    rooms.forEach((room, index) => {
        if (room.status === roomStatus.inProgress && room.actions.length === clientNumberOfRoom) {
            io.in(index).emit('update', {
                "tick": room.currentTick,
                "actions": room.actions,
            });
            room.actions = [];
            room.currentTick++;
        }
    });
}, 1000 / fps);

http.listen(3000, () => {
    console.log('listening on *:3000');
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/client.js', (req, res) => {
    res.sendFile(__dirname + '/client.js');
});
