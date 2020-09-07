window.onload = function() {
    const arenaEl = document.getElementById('arena');
    const matchingEl = document.getElementById("matching");
    const matchingButtonEl = document.getElementById("matching-button");
    const replayButtonEl = document.getElementById("replay-button");
    const matchingInfoEl = document.getElementById("matching-info");
    const consoleEl = document.getElementById("_console");

    const ctx = arenaEl.getContext("2d");

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
        "replaying": 3
    };
    const fps = 60;
    const roomSize = 2;

    var clientId = null;
    var history = {
        "entities": [],
        "actions": []
    };

    // status of each turn
    var timer;
    var entities = [];
    var entity = null;
    var currentStatus = status.idle;
    var tick = 0;
    var lastTick = -1;
    var lastTs;
    var req;
    
    const output = function(message) {
        consoleEl.innerHTML += message + "<br>";
    }

    const draw = function() {
        ctx.clearRect(0, 0, arenaEl.width, arenaEl.height);
        for (var entity of entities) {
            ctx.beginPath();
            ctx.arc(entity.position.x, entity.position.y, 20, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.fillStyle = entity.color;
            ctx.fill();
        }
        req = window.requestAnimationFrame(draw);
    }

    const bindInputHandler = function() {
        const keyHandler = function(event) {
            event.preventDefault();
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

    const unbindInputHandler = function() {
        document.body.onkeydown = null;
        document.body.onkeyup = null;
    }

    const resetStatus = function() {
        entities = [];
        currentStatus = status.idle;
        timer = undefined;
        tick = 0;
        lastTick = -1;
        lastTs = undefined;
        entity = null;
    }

    const updatePanel = function() {
        if (currentStatus === status.inProgress) {
            matchingEl.style.display = 'none';
        } else {
            matchingEl.style.display = 'inline-block';
            replayButtonEl.style.display = 'none';
            if (currentStatus === status.idle) {
                matchingButtonEl.style.display = 'inline-block';
                matchingInfoEl.style.display = 'none';
                if (history.actions.length > 0) {
                    replayButtonEl.style.display = 'inline-block';
                }
            } else if (currentStatus === status.pending) {
                matchingButtonEl.style.display = 'none';
                matchingInfoEl.style.display = 'inline-block';
            } else if (currentStatus === status.replaying) {
                matchingButtonEl.style.display = 'none';
                matchingInfoEl.style.display = 'none';
            }
        }
    }

    const updateEntities = function(action) {
        entities.forEach(function(entity) {
            if (entity.id === action.entityId) {
                var offset = action._dt * speed;
                if (action.type === actionTypes.moveToLeft) {
                    entity.position.x -= offset;
                } else if (action.type === actionTypes.moveToRight) {
                    entity.position.x += offset;
                } else if (action.type === actionTypes.moveToTop) {
                    entity.position.y -= offset;
                } else if (action.type === actionTypes.moveToBottom) {
                    entity.position.y += offset;
                }
            }
        });
    }

    matchingButtonEl.onclick = function() {
        if (socket.connected) {
            matchingInfoEl.innerHTML = "waiting...(0/" + roomSize + ")";
            currentStatus = status.pending;
            updatePanel();
            socket.emit('matching');
        } else {
            output("you've not connected to server");
        }
    }

    replayButtonEl.onclick = function() {
        if (history.entities.length < 1) {
            return;
        }
        currentStatus = status.replaying;
        entities = JSON.parse(JSON.stringify(history.entities));
        updatePanel();
        draw();
        var n = history.actions.length;
        var i = 0;
        var timer = setInterval(function() {
            var actions = history.actions.slice(i, i + roomSize);
            for (var action of actions) {
                updateEntities(action);
            }
            i += roomSize;
            if (i > n) {
                clearInterval(timer);
                window.cancelAnimationFrame(req);
                ctx.clearRect(0, 0, arenaEl.width, arenaEl.height);
                currentStatus = status.idle;
                i = 0;
                updatePanel();
            }
        }, 1000 / fps);
    }

    socket.on('connected', function(message) {
        clientId = message.clientId;
        output(message.info);
    });

    socket.on('connectFailed', function(message) {
        output(message.info);
    });

    socket.on('clientJoined', function(message) {
        matchingInfoEl.innerHTML = "waiting...(" + message.clientNumber + "/" + roomSize + ")";
        output(message.info);
    });

    socket.on('start', function(message) {
        clearInterval(timer);
        currentStatus = status.inProgress;
        entities = message.entities;
        entity = entities.find(entity => entity.clientId == clientId);
        if (!entity) {
            output("cannot get an entity");
            return;
        }
        setTimeout(function() {
            updatePanel();
            bindInputHandler();
            draw();
            timer = setInterval(function() {
                if (lastTick !== tick) {
                    var nowTs = +new Date();
                    var _dt = (nowTs - (lastTs || nowTs)) / 1000;
                    lastTs = nowTs;
                    var action;
                    if (key.left) {
                        action = { "_dt": _dt, "type": actionTypes.moveToLeft }
                    } else if (key.right) {
                        action = { "_dt": _dt, "type": actionTypes.moveToRight }
                    } else if (key.top) {
                        action = { "_dt": _dt, "type": actionTypes.moveToTop }
                    } else if (key.bottom) {
                        action = { "_dt": _dt, "type": actionTypes.moveToBottom }
                    } else {
                        action = {}
                    }
                    action.entityId = entity.id;

                    socket.emit('update', {
                        "tick": tick,
                        "action": action,
                    });
                    lastTick = tick;
                }
            }, 1000 / fps);
        }, 1000);
    });
    
    socket.on('update', function(message) {
        message.actions.forEach(function(action) {
            updateEntities(action);
        });
        tick++;
    });

    socket.on('clientLeft', function(message) {
        if (currentStatus === status.pending) {
            matchingInfoEl.innerHTML = "waiting...(" + message.currentClientNumber + "/" + roomSize + ")";
        }
        output(message.info);
    });

    socket.on('roomClosed', function(message) {
        ctx.clearRect(0, 0, arenaEl.width, arenaEl.height);
        clearInterval(timer);
        window.cancelAnimationFrame(req);
        resetStatus();
        unbindInputHandler();
        output(message.info);
        history = message.history;
        updatePanel();
    });

    socket.on('matchingFailed', function(message) {
        output(message.info);
    });

    updatePanel();
}
