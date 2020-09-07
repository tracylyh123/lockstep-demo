const app = require('express')();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const uuid = require('uuid');

const options = {
    "fps": 60,
    "roomNumber": 10,
    "roomSize": 2,
    "monitorInterval": 1
};

const clientStatus = {
    "idle": 0,
    "pending": 1,
    "inProgress": 2,
};

const roomStatus = {
    "pending": 0,
    "inProgress": 1
};

const colors = [
    'red', 
    'blue', 
    'black', 
    'green'
];

const arena = {
    "width": 500,
    "height": 200,
    "entity": {
        "radius": 20
    }
};

const actionTypes = [
    0, 
    1, 
    2, 
    3
];

const getRandomInt = (min, max) => {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

let Server = function(options) {
    this.fps = options.fps;
    this.roomNumber = options.roomNumber;
    this.roomSize = options.roomSize;
    this.monitorInterval = options.monitorInterval;
    this.clients = new Map();
    this.rooms = [];
}

Server.prototype.initRooms = function() {
    for (let i = 0; i < this.roomNumber; i++) {
        this.rooms[i] = new Room(i, this.roomSize);
    }
}

Server.prototype.isExceedMaxClientNumber = function() {
    return this.clients.size > (this.roomNumber * this.roomSize);
}

Server.prototype.setClient = function(socketId, client) {
    this.clients.set(socketId, client);
}

Server.prototype.getClientBySocketId = function(socketId) {
    return this.clients.get(socketId);
}

Server.prototype.removeClientBySocketId = function(socketId) {
    this.clients.delete(socketId);
}

Server.prototype.findPendingRoom = function() {
    return this.rooms.find(room => room.isPending());
}

Server.prototype.start = function() {
    io.on('connection', (socket) => {
        if (this.isExceedMaxClientNumber()) {
            socket.emit('connectFailed', {
                "info": "exceeded max client number"
            });
            socket.disconnect();
        } else {
            let client = new Client(uuid.v4());
            this.setClient(socket.id, client);
            socket.emit('connected', {
                "info": "you've connected",
                "clientId": client.id
            });
        }

        socket.on('matching', () => {
            let client = this.getClientBySocketId(socket.id);
            if (!client) {
                socket.emit('matchingFailed', {
                    "info": "client was not found"
                });
                return;
            }
            if (!client.isIdle()) {
                socket.emit('matchingFailed', {
                    "info": "invalid client status"
                });
                return;
            }
            let room = this.findPendingRoom();
            if (!room) {
                socket.emit('matchingFailed', {
                    "info": "no avaliable room"
                });
                return;
            }
            if (!client.join(room)) {
                socket.emit('matchingFailed', {
                    "info": "cannot join room: " + room.id
                });
                return;
            }
            socket.join(room.id);
            io.in(room.id).emit('clientJoined', {
                "info": "client: " + client.id + " joined room: " + room.id,
                "clientNumber": room.clients.length
            });
        });

        socket.on("update", (message) => {
            let client = this.getClientBySocketId(socket.id);
            if (!client || !client.room) {
                return;
            }
            let room = client.room;
            if (!room.isInProgress() || !client.isInProgress()) {
                return;
            }
            if (!message.hasOwnProperty('tick') || !room.isInSameTick(message.tick)) {
                return;
            }
            if (room.actionExistedInCurrentTick(client.id)) {
                return;
            }
            let type = -1;
            let _dt = 0;
            if (message.hasOwnProperty('action')) {
                let action = message.action;
                if (action.hasOwnProperty('entityId') && client.entityId === action.entityId) {
                    type = (action.hasOwnProperty('type') && actionTypes.includes(action.type)) ? action.type : -1;
                    _dt = action.hasOwnProperty('_dt') ? action._dt : 0;
                }
            }
            room.actions.push({
                "entityId": client.entityId,
                "type": type,
                "_dt": _dt
            });
        });

        socket.on('disconnect', () => {
            let client = this.getClientBySocketId(socket.id);
            if (!client) {
                return;
            }
            let room = client.room;
            if (room && !client.isIdle()) {
                client.leaveRoom();
                socket.to(room.id).emit('clientLeft', {
                    "info": "client: " + client.id + " left room: " + room.id,
                    "clientNumber": room.clients.length
                });
            }
            this.clients.delete(socket.id);
        });
    });

    console.log('lockstep server started')
}

Server.prototype.initMonitor = function() {
    setInterval(() => {
        this.rooms.forEach((room, roomId) => {
            if (room.couldBeStarted()) {
                room.start();
                io.in(roomId).emit('start', {
                    'entities': room.entities
                });
            }

            if (room.couldBeClosed()) {
                let history = {
                    "entities": room.entities,
                    "actions": room.actions
                };
                room.close();
                io.in(roomId).emit('roomClosed', {
                    "info": "room: " + roomId + " closed",
                    "history": history
                });
                io.in(roomId).clients((error, socketIds) => {
                    socketIds.forEach((socketId) => {
                        io.sockets.sockets[socketId].leave(roomId);
                    });
                });
            }
        });
    }, 1000 * this.monitorInterval);
}

Server.prototype.initUpdater  = function() {
    setInterval(() => {
        this.rooms.forEach((room, roomId) => {
            if (room.isInProgress() && room.receivedAllActionsInCurrentTick()) {
                io.in(roomId).emit('update', {
                    "tick": room.currentTick,
                    "actions": room.getActionsInCurrentTick(),
                });
                room.currentTick++;
            }
        });
    }, 1000 / this.fps);
}

Server.prototype.init = function() {
    this.initRooms();
    this.initMonitor();
    this.initUpdater();
    return this;
}

let Client = function(id) {
    this.id = id;
    this.entityId = null;
    this.room = null;
    this.status = clientStatus.idle;
}

Client.prototype.join = function(room) {
    if (room.isPending()) {
        room.clients.push(this);
        this.room = room;
        this.status = clientStatus.pending;
        return true;
    }
    return false;
}

Client.prototype.isIdle = function() {
    return this.status === clientStatus.idle;
}

Client.prototype.isInProgress = function() {
    return this.status === clientStatus.inProgress;
}

Client.prototype.leaveRoom = function() {
    if (this.room) {
        this.room.removeClientById(this.id);
        this.room = null;
    }
    this.entityId = null;
    this.status = clientStatus.idle;
}

let Room = function(id, size) {
    this.id = id;
    this.size = size;
    this.status = roomStatus.pending;
    this.currentTick = 0;
    this.clients = [];
    this.entities = [];
    this.actions = [];
}

Room.prototype.isFull = function() {
    return this.clients.length === this.size;
}

Room.prototype.couldBeStarted = function() {
    return this.isFull() && this.isPending();
}

Room.prototype.couldBeClosed = function() {
    return this.isInProgress() && !this.isFull();
}

Room.prototype.isInProgress = function() {
    return this.status === roomStatus.inProgress;
}

Room.prototype.isPending = function() {
    return this.status === roomStatus.pending;
}

Room.prototype.removeClientById = function(clientId) {
    this.clients = this.clients.filter(client => client.id !== clientId);
}

Room.prototype.isInSameTick = function(tick) {
    return this.currentTick === tick;
}

Room.prototype.getActionsInCurrentTick = function() {
    let begin = this.currentTick * this.size;
    let end = begin + this.size;
    return this.actions.slice(begin,  end);
}

Room.prototype.actionExistedInCurrentTick = function(clientId) {
    let actions = this.getActionsInCurrentTick();
    return actions.find(action => action.clientId === clientId) !== undefined;
}

Room.prototype.receivedAllActionsInCurrentTick = function() {
    return this.getActionsInCurrentTick().length === this.size;
}

Room.prototype.start = function() {
    if (!this.couldBeStarted()) {
        return false;
    }
    this.status = roomStatus.inProgress;
    for (var client of this.clients) {
        client.status = clientStatus.inProgress;
    }
    this.initEntities();
    return true;   
}

Room.prototype.initEntities = function() {
    this.entities = [];
    this.clients.forEach((client, index) => {
        client.entityId = index;
        this.entities.push({
            "id": index,
            "clientId": client.id,
            "radius": arena.entity.radius,
            "color": colors[index % colors.length],
            "position": {
                "x": getRandomInt(arena.entity.radius, arena.width - arena.entity.radius),
                "y": getRandomInt(arena.entity.radius, arena.height - arena.entity.radius)
            },
        });
    });
}

Room.prototype.close = function() {
    if (!this.couldBeClosed()) {
        return false;
    }
    for (let client of this.clients) {
        client.leaveRoom();
    }
    this.clients = [];
    this.actions = [];
    this.entities = [];
    this.currentTick = 0;
    this.status = roomStatus.pending;
    return true;
}

http.listen(3000, () => {
    console.log('listening on *:3000');
    let server = new Server(options);
    server.init().start();
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/client.js', (req, res) => {
    res.sendFile(__dirname + '/client.js');
});
