/*! 
 * Copyright(c) 2014 Jan Blaha 
 *
 * ExtensionsManager responsible for loading, registering and unregistering server extensions.
 */

var events = require("events"),
    util = require("util"),
    utils = require("./util/util.js"),
    fs = require("fs"),
    path = require('path'),
    S = require("string"),
    _ = require("underscore"),
    q = require("q"),
    ListenerCollection = require("./util/listenerCollection.js");

var ExtensionsManager = module.exports = function (reporter, settings, logger, options) {
    var self = this;
    events.EventEmitter.call(this);

    this.availableExtensions = [];
    this.recipes = [];
    this.reporter = reporter;
    this.options = options;
    this.settings = settings;
    this.logger = logger;

    Object.defineProperty(this, "extensions", {
        get: function () {
            return self.availableExtensions.filter(function (e) {
                return e.isRegistered;
            });
        }
    });
};

util.inherits(ExtensionsManager, events.EventEmitter);

ExtensionsManager.prototype.init = function () {
    var self = this;

    return this._findAvailableExtensions().then(function (extensions) {

        extensions.forEach(function (e) {
            e.options = self.options[e.name];
        });
        self.availableExtensions = extensions;

        var extensionsToRegister =  self.options.extensions ?
            self.options.extensions.slice(0) : _.map(extensions, function(e) { return e.name; });

        return self.use(extensionsToRegister).then(function () {
            self.logger.info("Extensions loaded.");
        });
    });
};

ExtensionsManager.prototype._useInternal = function (extension) {
    this.logger.info("Using extension " + extension);

    try {
        var extensionDefinition = _.findWhere(this.availableExtensions, { name: extension });

        if (!extensionDefinition)
            throw new Error("Extension not found in folder " + this.options.rootDirectory);


        require(path.join(extensionDefinition.directory, extensionDefinition.main)).call(this, this.reporter, extensionDefinition);

        extensionDefinition.isRegistered = true;
        this.emit("extension-registered", extensionDefinition);
    }
    catch (e) {
        this.logger.error("Error when loading extension " + extension + require('os').EOL + e.stack);
    }
};

ExtensionsManager.prototype.use = function (extension) {
    if (_.isString(extension))
        extension = [extension];

    var self = this;
    if (!_.isArray(extension)) {
        extension = [extension];
    }

    extension.forEach(function (e) {
        if (e !== "")
            self._useInternal(e);
    });

    return q();
};

var _availableExtensionsCache;
ExtensionsManager.prototype._findAvailableExtensions = function () {
    this.logger.info("Searching for available extensions in " + this.options.rootDirectory);

    if (this.options.cacheAvailableExtensions && _availableExtensionsCache) {
        this.logger.info("Loading extensions from cache " + _availableExtensionsCache.length);
        return q(_availableExtensionsCache);
    }

    var walk = function (dir, done) {
        var results = [];
        fs.readdir(dir, function (err, list) {
            if (err)self.logger.error(err);
            if (err) return done(err);
            var pending = list.length;
            if (!pending) return done(null, results);
            list.forEach(function (file) {
                file = path.join(dir, file);
                fs.stat(file, function (err, stat) {
                    if (err)self.logger.error(err);
                    if (stat && stat.isDirectory()) {
                        //ignore cycles in ..jsreport\node_modules\jsreport-import-export\node_modules\jsreport
                        if (S(dir).contains("node_modules") && S(file).endsWith("node_modules")) {
                            if (!--pending) done(null, results);
                        } else {
                            walk(file, function (err, res) {
                                if (err)self.logger.error(err);
                                results = results.concat(res);
                                if (!--pending) done(null, results);
                            });
                        }
                    } else {
                        if (S(file).contains("jsreport.config.js"))
                            results.push(file);
                        if (!--pending) done(null, results);
                    }
                });
            });
        });
    };
    var self = this;
    return q.nfcall(walk, this.options.rootDirectory).then(function (results) {
        self.logger.info("Found " + results.length + " extensions");
        var availableExtensions = results.map(function (configFile) {
            return _.extend({ directory: path.dirname(configFile) }, require(configFile));
        }).sort(function (pa, pb) {
            //todo, sort better by dependencies
            pa.dependencies = pa.dependencies || [];
            pb.dependencies = pb.dependencies || [];

            if (pa.dependencies.length > pb.dependencies.length) return 1;
            if (pa.dependencies.length < pb.dependencies.length) return -1;

            return 0;
        });

        _availableExtensionsCache = availableExtensions;
        return availableExtensions;
    });
};