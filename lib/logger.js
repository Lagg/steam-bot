// Copyright 2015+ Anthony Garcia <anthony@lagg.me>

var fs = require("fs"),
    path = require("path"),
    Configuration = require("./configuration");

function Logger(label, options) {
    var options = options || {};

    this.logDir = options.noFile? null : options.logDir || Configuration.raw.logDir;
    this.logLevel = options.logLevel || Configuration.raw.logLevel || Logger.DEFAULT_LEVEL_THRESHOLD;
    this.logName = options.logName || Logger.DEFAULT_NAME;
    this.levels = options.levels || {};
    this.label = label || this.logName;

    this.useConsole = !options.noConsole;
    this.useRotation = !options.noRotation;

    this.handleExceptions = options.handleExceptions;

    var self = this;

    // Assign default levels if not overridden
    Object.keys(Logger.DEFAULT_LEVELS).forEach(function(k) {
        self.levels[k] = self.levels[k] || Logger.DEFAULT_LEVELS[k];
    });

    // Add convenience funcs
    Object.keys(this.levels).forEach(this._addLog.bind(this));

    if (this.handleExceptions) {
        process.on("uncaughtException", this.emerg.bind(this, "uncaughtException:"));
    }
}

Logger._streams = {};

Logger.DEFAULT_NAME = "daemon";
Logger.DEFAULT_LEVEL_THRESHOLD = "debug";
Logger.DEFAULT_LABEL_CONSOLE_CODES = "97";
Logger.DEFAULT_LEVELS = {
    emerg: {
        consoleCodes: "41",
        level: 0
    },
    error: {
        consoleCodes: "31",
        level: 3
    },
    warn: {
        consoleCodes: "33",
        label: "warning",
        level: 4
    },
    info: {
        consoleCodes: "32",
        level: 6
    },
    debug: {
        consoleCodes: "90",
        level: 7
    }
};

Logger.close = function() {
    Object.keys(Logger._streams).forEach(function(logName) {
        Logger._streams[logName].stream.close();
    });

    delete Logger._streamsDisabled;
};

Logger.prototype.isLevelLoggable = function(level) {
    var levelInfo = this.levels[level] || {};
    var thresholdLevelInfo = this.levels[this.logLevel] || {};

    return levelInfo.level <= thresholdLevelInfo.level;
};

Logger.prototype.log = function() {
    var level = arguments[0];
    var output = [];

    for (var i = 1; i < arguments.length; i++) {
        var arg = arguments[i];

        if (arg instanceof Error) {
            arg = arg.name + ": " + arg.message + "\nStack: " + arg.stack;
        } else if (typeof arg == "object") {
            arg = JSON.stringify(arg);
        }

        output.push(arg);
    }

    var line = output.join(" ");
    this._writeLog(level, line);
    this._writeConsoleLog(level, line);
};

Logger.prototype._addLog = function(level) {
    var self = this;

    Object.defineProperty(this, level, {value: function() {
            var line = Array.prototype.slice.call(arguments);
            line.unshift(level);
            self.log.apply(self, line);
    }});
};

Logger.prototype._onStreamClose = function() {
    this._writeConsoleLog("debug", "Closing " + this.logName + " log");
};

Logger.prototype._onStreamError = function(err) {
    this._writeConsoleLog("error", (err.message || "Error") + " (disabling log files)");

    Logger._streamsDisabled = true;
};

Logger.prototype._onStreamReady = function() {
    this._writeConsoleLog("debug", "Opened " + this.logName + " log");
};

Logger.prototype._zpad = function(num, len) {
    var len = len || 2;
    var num = num.toString();
    var needed = len - num.length;
    var p = "";

    if (needed > 0) {
        while(needed--) { p += '0'; }
    }

    return p + num;
};

Logger.prototype._writeConsoleLog = function(level, line) {
    if (!this.isLevelLoggable(level) || !this.useConsole) {
        return false;
    }

    var levelInfo = this.levels[level] || {};
    var levelColor = levelInfo.consoleCodes || "0";
    var levelLabel = levelInfo.label || level;

    console.log(
        "[\x1b[" + Logger.DEFAULT_LABEL_CONSOLE_CODES + "m" + this.label + "\x1b[0m] "
        + "\x1b[" + levelColor + "m" + levelLabel + ":\x1b[0m "
        + line
    );

    return true;
};

Logger.prototype._writeLog = function(level, line) {
    if (!this.isLevelLoggable(level) || !this.logDir || Logger._streamsDisabled) {
        return false;
    }

    // Generate timestamp parts (date of year reused for filenaming)
    var date = new Date;

    var doy = (
        this._zpad(date.getFullYear()) + '-'
        + this._zpad(date.getMonth() + 1) + '-'
        + this._zpad(date.getDate())
    );

    var dateTag = ('['
        + doy
        + ' '
        + this._zpad(date.getHours()) + ':'
        + this._zpad(date.getMinutes()) + ':'
        + this._zpad(date.getSeconds())
        + ']');

    // If not rotating discard doy now that display stamp is done
    if (!this.useRotation) {
        doy = null;
    }

    // Check date of year to see if stream cache needs reopening
    var streamMeta = Logger._streams[this.logName] || {};
    var stream = streamMeta.stream;
    var lastDoy = streamMeta.doy;

    if (stream && doy != lastDoy) {
        stream.close();
    }

    if (!stream || !stream.writable) {
        var suffix = doy? "-" + doy : "";
        var filename = path.join(this.logDir, this.logName + suffix + ".log");

        stream = fs.createWriteStream(filename, {flags: "a"});

        Logger._streams[this.logName] = {
            stream: stream,
            doy: doy
        };

        stream.on("ready", this._onStreamReady.bind(this));
        stream.on("close", this._onStreamClose.bind(this));
        stream.on("error", this._onStreamError.bind(this));
    }

    // Final formatting and line write
    var levelTag = '[' + level.toUpperCase() + ']';
    var labelTag = '[' + this.label + ']';

    stream.write(dateTag + labelTag + levelTag + " " + line + "\n");

    return true;
};

module.exports = Logger;
