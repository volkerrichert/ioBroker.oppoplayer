/**
 *
 * oppoplayer adapter
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
const utils = require(__dirname + '/lib/utils'); // Get common adapter utils

const net = require('net'); // import net
const named = require('named-js-regexp');
const dgram = require('dgram');

//TODO remove me dummy
const node = null;

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.oppoplayer.0
const adapter = new utils.Adapter('oppoplayer');
const client = new net.Socket();
const parseTime = (player, data) => {
    data.h = parseInt(data.h);
    data.s = parseInt(data.s);
    data.m = parseInt(data.m);
    data.seconds = data.s + data.m * 60 + data.h * 3600;

    return data;
};

const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [
        h > 0 ? h : '0' + h,
        m > 9 ? m : '0' + m,
        s > 9 ? s : '0' + s,
    ].filter(a => a).join(':');
};

const atoi = (addr) => {
    if (!addr) return -1;

    var parts = addr.split('.').map(function(str) {
        return parseInt(str);
    });

    return (parts[0] ? parts[0] << 24 : 0) +
        (parts[1] ? parts[1] << 16 : 0) +
        (parts[2] ? parts[2] << 8  : 0) +
        parts[3];
};

const CommandPrefix = "#";
const AnswerPrefix = "@";

// Constants & Variables
let host;
let pollInterval;
let requestInterval;
let responseInterval;

let pollingVar = null;
let connectingVar = null;
let isPlayerOnline = false;

/**
 * OPPO doesn't response correctly on every command in case of error
 * @type {Array}
 */
let commandQuere = [];

let queryCommands = {
    'QPW': {    // Query power status'
        poll: false,
        response: '(?:QPW )?OK ([a-zA-Z]+)',
        updateResponse: 'UPW ([01])',
        state: 'info.online',
        handle: (player, state) => {
            isPlayerOnline = state === 'ON' || state === '1';

            adapter.setState('info.online', isPlayerOnline, true);
            if (isPlayerOnline) {
                sendRequest('SVM', '3');

                updatePowerOnStates(); // Update states when player is on
            } else {
                commandQuere = []
            }
        },
        setterFor:['info.online'],
        setState: (value) => {
            if (value) {
                sendRequest('POF');
            } else {
                sendRequest('PON');
            }
        }
    },
    'QVM': {    // Query verbose mode',
        state: 'settings.verbose',
        poll: false,
        response: '(?:QVM )?OK ([0-9])'
    },
    'QVR': {
        state: 'settings.firmware',
        poll: false,
        pollOnStart: true,
        response: '(?:QVR )?OK ([a-zA-Z0-9 \-]+)'
    },
    'QVL': {
        response: '(?:QVL )?OK ([a-zA-Z0-9]+)',
        updateResponse: 'UVL ([a-zA-Z0-9]+)',
        poll: false,
        pollOnStart: true,
        handle: (player, volume) => {
            if (volume === 'MUT' || volume === 'MUTE' || volume === 'UMT') {
                adapter.setState('settings.mute', volume !== 'UMT', true);
                return 0;
            }
            adapter.setState('settings.mute', false, true);
            adapter.setState('settings.volume', parseInt(volume), true);

            return parseInt(volume);
        },
        setterFor: ['settings.mute', 'settings.volume'],
        setState: (value) => {
            sendRequest('SVL', value);
        }
    },
    'QHD': {
        state: 'status.resolution',
        response: '(?:QHD )?OK ([a-zA-Z\ ]+)',
        updateResponse: 'UVO ([^\\r]+)',
        pollOnStart: true,
        setterFor: [],
        setState: (value) => {
            sendRequest('SHD', value);
        }
    },
    'QPL': {
        state: 'status.playback',
        response: '(?:QPL )?OK ([a-zA-Z ]+)',
        updateResponse: 'UPL ([a-zA-Z ]+)',
        pollOnStart: true
    },
    'QTK': {
        response: '(?:QTK )?OK (?<text>(?<title>[0-9]+)/(?<total>[0-9]+))',
        poll: true,
        handle: (command, data) => {
            adapter.setState('status.title', data.text, true);
            adapter.setState('status.title.current', parseInt(data.title), true);
            adapter.setState('status.title.total', parseInt(data.total), true);
        },
        setterFor: ['status.title.current'],
        setState: (id, value) => {
            sendRequest("SRH", "T" + value)
        }
    },
    'QCH': {
        desc: 'Query Chapter',
        response: '(?:QCH )?OK (?<text>(?<chapter>[0-9]+)/(?<total>[0-9]+))',
        poll: true,
        handle: (player, data) => {
            adapter.setState('status.chapter', data.text, true);
            adapter.setState('status.chapter.current', parseInt(data.chapter), true);
            adapter.setState('status.chapter.total', parseInt(data.total), true);
        },
        setterFor: ['status.chapter.current'],
        setState: (id, value) => {
            sendRequest("SRH", "C" + value)
        }
    },
    'QTE': {
        desc: 'Query Track/Title elapsed time',
        response: '(?:QTE )(?<status>OK (?<time>(?<h>[0-9][0-9]):(?<m>[0-9][0-9]):(?<s>[0-9][0-9]))|ER)',
        updateResponse: 'UTC (?<title>[^\ ]+) (?<chapter>[^\ ]+) E (?<time>(?<h>[0-9][0-9]):(?<m>[0-9][0-9]):(?<s>[0-9][0-9]))',
        poll: true,
        handle: (player, data) => {
            if (data.status !== 'ER') {
                parseTime(player, data);
                adapter.setState('status.elapsed.title', data.time, true);
                adapter.setState('status.elapsed.title.h', data.h, true);
                adapter.setState('status.elapsed.title.m', data.m, true);
                adapter.setState('status.elapsed.title.s', data.s, true);
                adapter.setState('status.elapsed.title.seconds', data.seconds, true);
            } else {
                adapter.setState('status.elapsed.title', false, true);
                adapter.setState('status.elapsed.title.h', false, true);
                adapter.setState('status.elapsed.title.m', false, true);
                adapter.setState('status.elapsed.title.s', false, true);
                adapter.setState('status.elapsed.title.seconds', false, true);
            }
        },
        setterFor: ['status.elapsed.title', 'status.elapsed.title.seconds'],
        setState: (id, value) => {
            sendRequest("SRH", "T " + (parseInt(value) == value ?formatTime(value) : value ));
        }
    },
    'QTR': {
        desc: 'Query Track/Title remaining time',
        response: '(?:QTR )(?<status>OK (?<time>(?<h>[0-9][0-9]):(?<m>[0-9][0-9]):(?<s>[0-9][0-9]))|ER)',
        updateResponse: 'UTC (?<title>[^ ]+) (?<chapter>[^ ]+) X (?<time>(?<h>[0-9][0-9]):(?<m>[0-9][0-9]):(?<s>[0-9][0-9]))',
        poll: true,
        handle: (player, data) => {
            if (data.status !== 'ER') {
                parseTime(player, data);
                adapter.setState('status.remaining.title', data.time, true);
                adapter.setState('status.remaining.title.h', data.h, true);
                adapter.setState('status.remaining.title.m', data.m, true);
                adapter.setState('status.remaining.title.s', data.s, true);
                adapter.setState('status.remaining.title.seconds', data.seconds, true);
            } else {
                adapter.setState('status.remaining.title', false, true);
                adapter.setState('status.remaining.title.h', false, true);
                adapter.setState('status.remaining.title.m', false, true);
                adapter.setState('status.remaining.title.s', false, true);
                adapter.setState('status.remaining.title.seconds', data.seconds, true);
            }
        }
    },
    'QCE': {
        desc: 'Query Chapter elapsed time',
        response: '(?:QCE )(?<status>OK (?<time>(?<h>[0-9][0-9]):(?<m>[0-9][0-9]):(?<s>[0-9][0-9]))|ER)',
        updateResponse: 'UTC (?<title>[^ ]+) (?<chapter>[^ ]+) C (?<time>(?<h>[0-9][0-9]):(?<m>[0-9][0-9]):(?<s>[0-9][0-9]))',
        poll: true,
        handle: (player, data) => {
            if (data.status !== 'ER') {
                parseTime(player, data);
                adapter.setState('status.elapsed.chapter', data.time, true);
                adapter.setState('status.elapsed.chapter.h', data.h, true);
                adapter.setState('status.elapsed.chapter.m', data.m, true);
                adapter.setState('status.elapsed.chapter.s', data.s, true);
                adapter.setState('status.elapsed.chapter.seconds', data.seconds, true);
            } else {
                adapter.setState('status.elapsed.chapter', false, true);
                adapter.setState('status.elapsed.chapter.h', false, true);
                adapter.setState('status.elapsed.chapter.m', false, true);
                adapter.setState('status.elapsed.chapter.s', false, true);
                adapter.setState('status.elapsed.chapter.seconds', false, true);
            }
        },
        setterFor: ['status.elapsed.chapter', 'status.elapsed.chapter.seconds'],
        setState: (id, value) => {
            sendRequest("SRH", "C " + (parseInt(value) == value ?formatTime(value) : value ))
        }
    },
    'QCR': {
        desc: 'Query Chapter remaining time',
        response: '(?:QCR )(?<status>OK (?<time>(?<h>[0-9][0-9]):(?<m>[0-9][0-9]):(?<s>[0-9][0-9]))|ER)',
        updateResponse: 'UTC (?<title>[^ ]+) (?<chapter>[^ ]+) K (?<time>(?<h>[0-9][0-9]):(?<m>[0-9][0-9]):(?<s>[0-9][0-9]))',
        poll: true,
        handle: (player, data) => {
            if (data.status !== 'ER') {
                parseTime(player, data);
                adapter.setState('status.remaining.chapter', data.time, true);
                adapter.setState('status.remaining.chapter.h', data.h, true);
                adapter.setState('status.remaining.chapter.m', data.m, true);
                adapter.setState('status.remaining.chapter.s', data.s, true);
                adapter.setState('status.remaining.chapter.seconds', data.seconds, true);
            } else {
                adapter.setState('status.remaining.chapter', false, true);
                adapter.setState('status.remaining.chapter.h', false, true);
                adapter.setState('status.remaining.chapter.m', false, true);
                adapter.setState('status.remaining.chapter.s', false, true);
                adapter.setState('status.remaining.chapter.seconds', false, true);
            }
        }
    },
    'QEL': {
        desc: 'Query Total elapsed time',
        response: '(?:QEL )(?<status>OK (?<time>(?<h>[0-9][0-9]):(?<m>[0-9][0-9]):(?<s>[0-9][0-9]))|ER)',
        updateResponse: 'UTC\ (?<title>[^\ ]+)\ (?<chapter>[^\ ]+)\ T (?<time>(?<h>[0-9][0-9]):(?<m>[0-9][0-9]):(?<s>[0-9][0-9]))',
        poll: true,
        handle: (player, data) => {
            if (data.status !== 'ER') {
                parseTime(player, data);
                adapter.setState('status.elapsed.total', data.time, true);
                adapter.setState('status.elapsed.total.h', data.h, true);
                adapter.setState('status.elapsed.total.m', data.m, true);
                adapter.setState('status.elapsed.total.s', data.s, true);
                adapter.setState('status.elapsed.total.seconds', data.seconds, true);
            } else {
                adapter.setState('status.elapsed.total', false, true);
                adapter.setState('status.elapsed.total.h', false, true);
                adapter.setState('status.elapsed.total.m', false, true);
                adapter.setState('status.elapsed.total.s', false, true);
                adapter.setState('status.elapsed.total.seconds', false, true);
            }
        },
        setterFor: ['status.elapsed.total', 'status.elapsed.total.seconds'],
        setState: (id, value) => {
            sendRequest("SRH", (parseInt(value) == value ?formatTime(value) : value ));
        }
    },
    'QRE': {
        desc: 'Query Total remaining time',
        response: '(?:QRE )(?<status>OK (?<time>(?<h>[0-9][0-9]):(?<m>[0-9][0-9]):(?<s>[0-9][0-9]))|ER)',
        updateResponse: 'UTC (?<title>[^ ]+) (?<chapter>[^ ]+) R (?<time>(?<h>[0-9][0-9]):(?<m>[0-9][0-9]):(?<s>[0-9][0-9]))',
        poll: true,
        handle: (player, data) => {
            if (data.status.startsWith('OK')) {
                parseTime(player, data);
                adapter.setState('status.remaining.total', data.time, true);
                adapter.setState('status.remaining.total.h', data.h, true);
                adapter.setState('status.remaining.total.m', data.m, true);
                adapter.setState('status.remaining.total.s', data.s, true);
                adapter.setState('status.remaining.total.seconds', data.seconds, true);
            } else {
                adapter.setState('status.remaining.total', false, true);
                adapter.setState('status.remaining.total.h', false, true);
                adapter.setState('status.remaining.total.m', false, true);
                adapter.setState('status.remaining.total.s', false, true);
                adapter.setState('status.remaining.total.seconds', false, true);
            }
        }
    },
    'QDT': {
        desc: 'Query disc type',
        state: 'status.disc',
        response: '(?:QDT )?OK ([a-zA-Z \-]+)',
        updateResponse: 'UDT ([a-zA-Z -]+)',
        pollOnStart: true
    },
    'QAT': {
        desc: 'Query audio type',
        response: '(?:QAT )?OK (?<text>(?<type>[^ ]+) (?<track>[0-9]+)/(?<total>[0-9]+)(?: (?<language>[A-Za-z]*)))',
        updateResponse: 'UAT (?<text>(?<type>[^ ]+) (?<track>[0-9]+)/(?<total>[0-9]+)(?: (?<language>[A-Za-z]*)))',
        pollOnStart: true,
        handle: (player, data) => {
            adapter.setState("status.audio", data.text, true);
            adapter.setState("status.audio.type", data.type, true);
            adapter.setState("status.audio.track", data.track, true);
            adapter.setState("status.audio.total", data.total, true);
            adapter.setState("status.audio.language", data.language, true);
        }
    },
    'QST': {
        desc: 'Query subtitle type',
        response: '(?:QST )?OK (?<text>OFF|(?<number>[0-9]+)/(?<total>[0-9]+)(?: (?<language>[A-Za-z]*)))',
        updateResponse: 'UST (?<text>OFF|(?<number>[0-9]+)/(?<total>[0-9]+)(?: (?<language>[A-Za-z]*)))',
        pollOnStart: true,
        handle: (player, data) => {
            adapter.setState("status.subtitle", data.text, true);
            adapter.setState("status.subtitle.number", data.number, true);
            adapter.setState("status.subtitle.total", data.total, true);
            adapter.setState("status.subtitle.language", data.language, true);
        }
    },
    'QSH': {
        desc: 'Query subtitle shift',
        state: 'status.subtitle.shift',
        response: '(?:QSH )?OK ([0-9\-]+)',
        pollOnStart: true,
        setterFor: ['status.subtitle.shift'],
        setState: (id, value) => {
            var val = parseInt(value);
            if (val >= -10 && val <= 10) {
                sendRequest("SSH", value);
            }
        }
    },
    'QOP': {
        desc: 'Query OSD position',
        state: 'status.osd',
        response: '(?:QOP )?OK ([0-5]+)',
        pollOnStart: true,
        setterFor: ['status.osd'],
        setState: (id, value) => {
            var val = parseInt(value);
            if (val >= -10 && val <= 10) {
                sendRequest("SOP", value);
            }
        }
    },
    'QRP': {
        desc: 'Query Repeat Mode',
        state: 'status.repeat',
        response: '(?:QRP )?OK (?<number>[0-5][0-5]) (?<text>[A-Za-z \-]+)',
        pollOnStart: true,
        handle: (player, data) => {
            adapter.setState('status.repeat', data.number, true)
        },
        setterFor: ['status.repeat'],
        setState: (id, value) => {
            const params = {
                "00": "OFF",
                "01": "ONE",
                "02": "CH",
                "03": "ALL",
                "04": "TT",
                "05": "SHF",
                "06": "RND"
            };

            if (typeof params[value] === 'string') {
                sendRequest('SRP', params[value]);
            } else {
                adapter.log.error('[COMMAND] valid repeat mode ' + value);
            }
            sendRequest('QRP');  // cquery after update
        }
    },
    'QZM': {
        desc: 'Query Zoom Mode',
        response: '(?:QZM )?OK (?<number>[0-5][0-5]) (?<text>[A-Za-z \-]+)',
        pollOnStart: true,
        handle: (player, data) => {
            adapter.setState('status.zoom', data.number, true)
        },
        setterFor: ['status.zoom'],
        setState: (id, value) => {
            const params = {
                "00": "1",
                "01": "AR",
                "02": "FS",
                "03": "US",
                "04": "1.2",
                "05": "1.3",
                "06": "1.5",
                "07": "2",
                "08": "3",
                "09": "4",
                "10": "1/2",
                "11": "1/3",
                "12": "1/4"
            };

            if (typeof params[value] === 'string') {
                sendRequest('SZM', params[value]);
            } else {
                adapter.log.error('[COMMAND] valid zoom mode ' + value);
            }
            sendRequest("QZM");
        }
    },

    // added with UDP20X-54-1127
    'QHS': {
        desc: 'Query HDR Status',
        state: 'status.hdr',
        response: '(?:QHS )?OK ([a-zA-Z\ ]+)',
        pollOnStart: true
    },
    'QHR': {
        desc: 'Query HDR Settings',
        state: 'settings.hdr',
        response: '(?:QHR )?OK ([a-zA-Z\ ]+)',
        pollOnStart: true,
        setterFor: ['settings.hdr'],
        setState: (id, value) => {
            sendRequest("SHR", value);
        }
    },
    'QIS': {
        desc: 'Query Input Source',
        state: 'settings.input',
        response: '(?:QIS )?OK (?<number>[0-9]) (?<name>[a-zA-Z ]+)',
        updateResponse: 'UIS (?<number>[0-9]) (?<name>[a-zA-Z ]+)',
        handle: (player, data) => {
            adapter.setState('settings.input', data.number, true)
        },
        pollOnStart: true,
        setterFor: ['settings.input'],
        setState: (id, value) => {
            sendRequest("SIS", value);
        }
    },
    'QAR': {
        desc: 'Query aspect ratio setting',
        state: 'status.aspect',
        response: '(?:QAR )?OK ([0-9a-zA-Z\ ]+)',
        updateResponse: 'UAR ([0-9a-zA-Z ]+)',
        pollOnStart: true
    },
    'Q3D': {
        desc: 'Query 3D Status',
        state: 'status.3d',
        response: '(?:Q3D )?OK ([0-9a-zA-Z\ ]+)',
        updateResponse: 'U3D ([0-9a-zA-Z ]+)',
        pollOnStart: true
    }
};

let setCommands = {
    'NOP': {
        response: 'OK'
    },
    'SVM': {
        response: '(?:SVM )?OK (\\d)',
        queryCommand: 'QVM'
    },
    'POW': {
        response: '(?:POW )?OK ([a-zA-Z]+)',
        queryCommand: 'QPW'
    },
    'PON': {
        response: 'OK (ON)',
        queryCommand: 'QPW'
    },
    'POF': {
        response: 'OK (OFF)',
        queryCommand: 'QPW'
    },
    'SHD': {
        response: 'OK ([a-zA-Z0-9_]+)',
        queryCommand: 'QHD'
    },
    'SSH': {
        response: 'SSH OK ([0-9-]+)',
        queryCommand: 'QSH'
    },
    'SOP': {
        response: 'SOP OK ([0-9-]+)',
        queryCommand: 'QOP'
    },
    'SZM': {
        response: 'SZM OK ([a-zA-Z0-9_]+)',
        queryCommand: 'QZM'
    },
    'SVL': {
        response: 'SVL OK ([a-zA-Z0-9_]+)',
        queryCommand: 'QVL'
    },
    'SRP': {
        response: 'SRP OK ([a-zA-Z0-9_]+)',
        queryCommand: 'QRP'
    },
    'SRH': {
        response: 'SRP OK'
    },
    'DPL': { response: 'DPL OK' },
    'RST': { response: 'RST OK' },
    'STC': { response: 'STC OK ([ERTXCK])' },
    'SHR': {
        response: 'SRP OK ([a-zA-Z]+)',
        queryCommand: 'QHR'
    },
    'SIS': {
        response: 'SRP OK (?<number>[0-9]) (?<name>[a-zA-Z ]+)',
        queryCommand: 'QIS'
    },
    'SSA': { response: 'SRP OK ([a-zA-Z]+)' },
    'APP': { response: 'APP OK ([a-zA-Z]+)' },
    'SSD': { response: 'SSD OK ([MSC]+)' },
    'SDP': { response: 'SDP OK ([DPA]+)' },
    'FWD': { response: 'FWD OK ([0-9\/]+)' },
    'REV': { response: 'REV OK ([0-9/]+)' },
    'QDR': { /* unimplemented */}
};

// some caching stuff
let updateCommands = {};
let setter = {};

Object.keys(queryCommands).forEach(function (key) {
    let command = queryCommands[key];

    queryCommands[key].poll = command.poll || false;
    queryCommands[key].pollOnStart = command.pollOnStart || false;
    if (command.response) {
        command.responseRegEx = named('^' + command.response);
    } else {
        command.responseRegEx = named('^' + key);
    }
    if (command.updateResponse) {
        let updateResponse = command.updateResponse;
        let updateCommand = updateResponse.substr(0, 3);

        if (!updateCommands[updateCommand]) {
            updateCommands[updateCommand] = []
        }
        updateCommands[updateCommand].push({
            queryCommand: key,
            regexp: named('^' + updateResponse),
            handle: command.handle,
            state: command.state || false
        });
    }

    if (command.setterFor && command.setState) {
        command.setterFor.forEach(state => {
            setter[state] = command.setState;
        })

    }
});

Object.keys(setCommands).forEach(function (key) {
    let command = setCommands[key];

    if (command.response) {
        command.responseRegEx = named('^' + command.response);
    } else {
        command.responseRegEx = named('^OK');
    }
});

let players = {};
let list = [];
let oppoDetect = null;

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', callback => {
    try {
        adapter.log.info('[END] Stopping Oppo player adapter...');
        adapter.setState('info.connection', false, true);
        client.destroy(); // kill connection
        client.unref();	// kill connection
        stopOppoDetection();

        callback();
    } catch (e) {
        callback();
    } // endTryCatch
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    if (typeof obj === 'object') {
        if (obj.command === 'browse') {
            if (obj.callback) {
                adapter.sendTo(obj.from, obj.command, {error: null, list: list}, obj.callback);
            } // endIf
        } // endIf
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    startOppoDetection();

    if (adapter.config.ip) {
        adapter.log.info('[START] Starting OPPO player adapter');

        // init
        host = adapter.config.ip;
        pollInterval = adapter.config.pollInterval || 5000;
        requestInterval = adapter.config.requestInterval || 100;

        responseInterval = adapter.config.responseInterval || 1000;

        main();
    } else adapter.log.warn('No IP-address set');
});

function stopOppoDetection() {
    if (oppoDetect !== null) {
        oppoDetect.close();
        oppoDetect = null;
    }
}

function startOppoDetection() {
    adapter.log.info('[OPPO] auto discovering starting');
    oppoDetect = dgram.createSocket('udp4');

    oppoDetect.on('close', function () {
        adapter.log.info('[OPPO] auto discovering stopped');
    });

    oppoDetect.on('error', (err) => {
        adapter.log.error("[OPPO] discovering server error: " + err.message);
        oppoDetect.close();
        oppoDetect = null;
    });

    let playerIp = -1;
    let friendlyName = "";
    adapter.getState("info.friendlyName", (err, state) => {
        friendlyName = (state && state.ack ? state.val : "");

        adapter.getState("info.ip", (err, state) => {
            playerIp = (state && state.ack ? atoi(state.val) : -1);

            if (!friendlyName && typeof players[playerIp] !== 'undefined') {
                // write name of player
                adapter.setState("info.friendlyName", players[playerIp].name, true);
            }
        });
    });

    oppoDetect.on('message', function (msg, rinfo) {
        let content = msg.toString();

        // checking for OPPO Header
        if (content.startsWith('Notify:OPPO Player Start')) {
            let lines = content.split('\n');
            let ip = lines[1].split(':')[1] || "";

            if (ip !== "" && typeof players[ip] === 'undefined') {
                let playerName;
                if (lines.length > 3) { // OPPO 10x dosn't submit player name
                    playerName = lines[3].split(':')[1];
                } else {
                    playerName = "OPPO 10x (" + ip + ")"
                }

                if (!friendlyName && atoi(ip) === playerIp) {
                    // write name of player
                    adapter.setState("info.friendlyName", playerName, true);
                    friendlyName = playerName;
                }

                list.push(players[ip] = {
                    'ip': ip,
                    'port': lines[2].split(':')[1],
                    'name': playerName
                });
            }

            //adapter.sendTo(obj.from, obj.command, {error: null, list: list}, obj.callback);
        }
    });

    oppoDetect.on('listening', function () {
        oppoDetect.setBroadcast(true);
        adapter.log.info('[OPPO] auto discovering started');
    });

    oppoDetect.bind(7624);
}

function main() {
    adapter.subscribeStates('*');
    adapter.setState('info.ip', host, true);

    connect();
}

client.on('timeout', () => {
    commandQuere = [];
    pollingVar = false;
    adapter.log.debug('Player timed out due to no response');
    adapter.setState('info.connection', false, true);
    adapter.setState('info.online', false, true);
    client.destroy();
    client.unref();
    connectingVar = setTimeout(() => connect(), 30000); // Connect again in 30 seconds
});

// Connection handling
client.on('error', error => {
    adapter.setState('info.connection', false, true);
    adapter.setState('info.online', false, true);
    commandQuere = [];
    if (connectingVar) return;
    if (error.code === 'ECONNREFUSED') adapter.log.debug('Connection refused, make sure that there is no other Telnet connection');
    else if (error.code === 'EHOSTUNREACH') adapter.log.debug('Player unreachable, check the Network Config of your OPPO player');
    else if (error.code === 'EALREADY' || error.code === 'EISCONN') adapter.log.debug('Adapter is already connecting/connected');
    else adapter.log.debug('Connection closed: ' + error);
    pollingVar = false;
    if (!connectingVar) {
        client.destroy();
        client.unref();
        connectingVar = setTimeout(() => connect(), 30000); // Connect again in 30 seconds
    } // endIf
});

client.on('end', () => { // Oppo has closed the connection
    adapter.log.warn('OPPO player has cancelled the connection');
    commandQuere = [];
    pollingVar = false;
    adapter.setState('info.connection', false, true);
    adapter.setState('info.online', false, true);
    if (!connectingVar) {
        client.destroy();
        client.unref();
        connectingVar = setTimeout(() => connect(), 30000); // Connect again in 30 seconds
    } // endIf
});

client.on('connect', () => { // Successfull connected
    clearTimeout(connectingVar);
    connectingVar = null;
    adapter.setState('info.connection', true, true);
    adapter.log.info('[CONNECT] Adapter connected to OPPO player: ' + host + ':23');

    sendRequest('QPW'); // testing if OPPO powered
});

client.on('data', data => {
    // split data by <cr>
    const dataArr = data.toString().split(/[\r\n]+/); // Split by Carriage Return
    for (let i = 0; i < dataArr.length; i++) {
        if (dataArr[i]) { // dataArr[i] contains element
            adapter.log.silly('<== ' + dataArr[i]);
            handleResponse(dataArr[i]);
        } // endIf
    } // endFor
    sendToClient();
});


// Handle state changes
adapter.on('stateChange', (id, state) => {
    if (!id || !state || state.ack || state.from === 'system.adapter.' + adapter.namespace) return; // Ignore acknowledged state changes or error states or local changes

    id = id.substring(adapter.namespace.length + 1); // remove instance name and id
    state = state.val; // only get state value

    adapter.log.debug('[COMMAND] State Change - ID: ' + id + '; State: ' + state);

    if (typeof setter[id] === 'function') {
        setter[id](id, state);
    } else if (id.startsWith('remote')) {
        if (id === 'remote._cmd') {
            sendRequest(state.toUpperCase())
            adapter.setState(id, '', true);
        } else sendRequest(id.substring(7).toUpperCase())
    }
}); // endOnStateChange

adapter.getForeignObject(adapter.namespace, (err, obj) => { // create device namespace
    if (!obj) {
        adapter.setForeignObject(adapter.namespace, {
            type: 'device',
            common: {
                name: 'OPPO player '
            }
        });
    } // endIf
});

/**
 * Internals
 */
function connect() {
    client.setTimeout(0);
    adapter.log.debug('Trying to connect to ' + host + ':23');
    connectingVar = null;
    client.connect({port: 23, host: host});
} // endConnect

let pollOnStartCommands = Object.keys(queryCommands).filter((key) => {
    return queryCommands[key].pollOnStart || false;
})

let pollCommands = Object.keys(queryCommands).filter((key) => {
    return queryCommands[key].poll || false;
})

function updatePowerOnStates() {
    adapter.log.debug('Connected --> updating states');

    if (pollOnStartCommands.length > 0 && isPlayerOnline) {
        let i = 0;
        let intervalVar = setInterval(() => {
            sendRequest(pollOnStartCommands[i]);
            i++;
            if (i == pollOnStartCommands.length) clearInterval(intervalVar);
        }, requestInterval);
    }
} // endUpdateStates

function pollStates() { // Polls states
    if (pollCommands.length > 0 && isPlayerOnline) {
        let i = 0;

        pollingVar = false;
        let intervalVar = setInterval(() => {
            sendRequest(pollCommands[i]);
            i++;
            if (i == pollCommands.length) clearInterval(intervalVar);
        }, requestInterval);
    }
} // endPollStates

function sendRequest(cmd, param) {
    const now = Date.now();

    // remove first commands if older than [responseInterval]sec
    // improve this
    while (commandQuere.length > 0 && commandQuere[0].timestamp !== null && commandQuere[0].timestamp + responseInterval < now) {
        commandQuere.shift();
    }

    // player doesn't answer on most commands while being off. Don't queue them
    if (isPlayerOnline || cmd === 'QPW' || cmd === 'POW' || cmd === 'PON' ) {
        param = param || null;

        commandQuere.push({
            'name': cmd,
            'parameter': param,
            'timestamp': null   // send timestemp
        });

        adapter.log.silly('=== ' + cmd + (param !== null ? ' ' + param : ''));

        sendToClient();
    }


} // endSendRequest

function sendToClient() {
    if (commandQuere.length >= 1) {
        let command = commandQuere[0];
        if (command.timestamp === null) {
            // command not send
            command.timestamp = Date.now();
            adapter.log.debug('==> ' + CommandPrefix + command.name + (command.parameter !== null ? ' ' + command.parameter : ''));
            //client.setTimeout(responseInterval + 1000); // oppo has to answer in 3 sec
            client.write(CommandPrefix + command.name + (command.parameter !== null ? ' ' + command.parameter : '') + "\r\n");
        } else {
            const now = Date.now();

            while (commandQuere.length > 0 && commandQuere[0].timestamp !== null && commandQuere[0].timestamp + responseInterval < now) {
                commandQuere.shift();
            }

            if (client !== null) client.setTimeout(0);
        }
    } else {
        if (client !== null) client.setTimeout(0);
    }
};

function handleResponse(data) {
    if (!pollingVar && isPlayerOnline && pollInterval > 0) { // Keep connection alive & poll states
        pollingVar = true;
        setTimeout(() => pollStates(), pollInterval); // Poll states every configured  seconds
    } // endIf
    // get command out of String
    if (data.startsWith(AnswerPrefix)) {
        let answer = data.substr(1);
        let matched = null;

        if (answer.startsWith('U')) { // receive update response
            let updateCommand = answer.substr(0, 3);
            if (updateCommands[updateCommand]) {
                // try to match response
                for (let i = 0; i < updateCommands[updateCommand].length; i++) {

                    let matched = answer.match(updateCommands[updateCommand][i].regexp);
                    if (!matched) continue;

                    let handle = updateCommands[updateCommand][i].handle || ((command, data) => setState(command, data));
                    if (Object.keys(matched.groups()).length > 0) { // names groups
                        handle(updateCommands[updateCommand][i], matched.groups())
                    } else {
                        handle(updateCommands[updateCommand][i], matched[1])
                    }

                    break;
                }
            }
        } else if (commandQuere.length > 0) {
            let command = commandQuere[0].name;
            let queryCommand = queryCommands[command];
            if (queryCommand) {
                commandQuere.shift();
                matched = answer.match(queryCommand.responseRegEx);

                if (matched) {
                    let handle = queryCommand.handle || ((command, data) => setState(command, data));
                    if (Object.keys(matched.groups()).length > 0) { // names groups
                        handle(queryCommand, matched.groups())
                    } else {
                        handle(queryCommand, matched[1]);
                    }
                }
            } else {
                let setCommand = setCommands[command];
                if (setCommand) {
                    commandQuere.shift();
                    matched = answer.match(setCommand.responseRegEx);

                    if (matched && setCommand.queryCommand) {
                        let handle = queryCommands[setCommand.queryCommand].handle || ((command, data) => setState(command, data));
                        if (Object.keys(matched.groups()).length > 0) { // names groups
                            handle(queryCommands[setCommand.queryCommand], matched.groups());
                        } else {
                            handle(queryCommands[setCommand.queryCommand], matched[1]);
                        }
                    }
                }
            }
        } else {

        }
    }

    sendToClient();
} // endHandleResponse

function setState(queryCommand, value) {
    if (queryCommand.state) {
        adapter.setState(queryCommand.state, value, true);
    }
}