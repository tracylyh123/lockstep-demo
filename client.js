window.onload = () => {
    const arena = document.getElementById('arena');
    const ctx = arena.getContext("2d");
    const socket = io();

    const speed = 50;
    const actionTypes = {
        "moveToLeft": 0,
        "moveToTop": 1,
        "moveToRight": 2,
        "moveToBottom": 3,
    };
    const key = {
        "left": false,
        "top": false,
        "right":false,
        "bottom": false
    };
    const status = {
        "idle": 0,
        "pending": 1,
        "inProgress": 2,
    };
    const fps = 60;

    // status of each turn
    let timer;
    let clients = [];
    let currentStatus = status.idle;
    let totalClientNumber = 0;
    let tick = 0;
    let lastTick = -1;
    let actions = [];
    let lastTs;
    let req;

    let _matching = document.getElementById("matching");
    let _matchingButton = document.getElementById("matching-button");
    let _matchingInfo = document.getElementById("matching-info");
    let _console = document.getElementById("_console");
    
    let output = (message) => {
        _console.innerHTML += message + "<br>";
    }

    let draw = () => {
        ctx.clearRect(0, 0, arena.width, arena.height);
        clients.forEach((client, index) => {
            ctx.beginPath();
            ctx.arc(client.position.x, client.position.y, 20, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.fillStyle = client.color;
            ctx.fill();
        });
        req = window.requestAnimationFrame(draw);
    }

    _matchingButton.addEventListener('click', () => {
        if (socket.connected) {
            _matchingInfo.innerHTML = "waiting...(0/" + totalClientNumber + ")";
            currentStatus = status.pending;
            resetPanel();
            socket.emit('matching');
        } else {
            output("you've not connected to server");
        }
    });

    socket.on('connected', (message) => {
        totalClientNumber = message.totalClientNumber;
        output(message.info);
    });

    socket.on('connectFailed', (message) => {
        output(message.info);
    });

    socket.on('clientJoined', (message) => {
        _matchingInfo.innerHTML = "waiting...(" + message.currentClientNumber + "/" + message.totalClientNumber + ")";
        output(message.info);
    });

    socket.on('start', (message) => {
        clearInterval(timer);
        bindInputHandler();
        currentStatus = status.inProgress;
        clients = message.clients;
        setTimeout(() => {
            resetPanel();
            timer = setInterval(() => {
                if (lastTick !== tick) {
                    let nowTs = +new Date();
                    let delta = (nowTs - (lastTs || nowTs)) / 1000.0;
                    lastTs = nowTs;
                    let action;
                    if (key.left) {
                        action = { "delta": delta, "type": actionTypes.moveToLeft }
                    } else if (key.right) {
                        action = { "delta": delta, "type": actionTypes.moveToRight }
                    } else if (key.top) {
                        action = { "delta": delta, "type": actionTypes.moveToTop }
                    } else if (key.bottom) {
                        action = { "delta": delta, "type": actionTypes.moveToBottom }
                    } else {
                        action = {}
                    }

                    socket.emit('update', {
                        "tick": tick,
                        "action": action,
                    });
                    lastTick = tick;
                }
            }, 1000 / fps);
            draw();
        }, 1000);
    });
    
    socket.on('update', (message) => {
        message.actions.forEach((client) => {
            clients.forEach((_client) => {
                if (_client.id === client.id) {
                    let offset = client.action.delta * speed;
                    if (client.action.type === actionTypes.moveToLeft) {
                        _client.position.x -= offset;
                    } else if (client.action.type === actionTypes.moveToRight) {
                        _client.position.x += offset;
                    } else if (client.action.type === actionTypes.moveToTop) {
                        _client.position.y -= offset;
                    } else if (client.action.type === actionTypes.moveToBottom) {
                        _client.position.y += offset;
                    }
                }
            });
        });
        tick++;
    });

    socket.on('clientLeft', (message) => {
        if (currentStatus === status.pending) {
            _matchingInfo.innerHTML = "waiting...(" + message.currentClientNumber + "/" + message.totalClientNumber + ")";
        }
        output(message.info);
    });

    socket.on('roomClosed', (message) => {
        ctx.clearRect(0, 0, arena.width, arena.height);
        clearInterval(timer);
        window.cancelAnimationFrame(req);
        resetStatus();
        resetPanel();
        unbindInputHandler();
        output(message.info);
    });

    socket.on('matchingFailed', (message) => {
        output(message.info);
    });

    let bindInputHandler = () => {
        let keyHandler = function(event) {
            if (event.keyCode === 37) {
                key.left = (event.type === "keydown");
            } else if (event.keyCode === 38) {
                key.top = (event.type === "keydown");
            } else if (event.keyCode == 39) {
                key.right = (event.type === "keydown");
            } else if (event.keyCode === 40) {
                key.bottom = (event.type === "keydown");
            }
        }
        document.body.onkeydown = keyHandler;
        document.body.onkeyup = keyHandler;
    }

    let unbindInputHandler = () => {
        document.body.onkeydown = null;
        document.body.onkeyup = null;
    }

    let resetStatus = () => {
        clients = [];
        currentStatus = status.idle;
        timer = undefined;
        totalClientNumber = 0;
        tick = 0;
        lastTick = -1;
        actions = [];
        lastTs = undefined;
    }

    let resetPanel = () => {
        if (currentStatus === status.inProgress) {
            _matching.style.display = 'none';
        } else {
            _matching.style.display = 'inline-block';
            if (currentStatus === status.idle) {
                _matchingButton.style.display = 'inline-block';
                _matchingInfo.style.display = 'none';
            } else if (currentStatus === status.pending) {
                _matchingButton.style.display = 'none';
                _matchingInfo.style.display = 'inline-block';
            }
        }
    }

    resetPanel();
}
