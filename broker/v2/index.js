/*
 * Cloud Foundry Services Connector
 * Copyright (c) 2014 ActiveState Software Inc. All rights reserved.
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */

/** @module BrokerV2 */

'use strict';

var Common = require('../../common');
var Db = require('../db');
var Events = require('events');
var Logule = require('logule');
var Handlers = require('./api-handlers');
var Restify = require('restify');
var RestifyMiddleware = require('../../common/restify-middleware');
var Url = require('url');
var Util = require('util');

/**
 * The Broker starts a restify broker that talks to the CF cloud controller
 * API, primarily for updating the service catalog and service plans.
 * @constructor
 * @param {Object} opts - Broker options.
 */
var BrokerV2 = function (opts) {

    if (!(this instanceof BrokerV2)) {
        return new BrokerV2(opts);
    }

    Events.EventEmitter.call(this);

    this.opts = opts;
    this.service = opts.service;

    this.log = Logule.init(module, 'V2 Broker - ' + this.opts.name);
    opts.database = Common.extend(opts.database, { apiVersion: this.opts.semver.major});
    this.db = new Db(opts.database);

    return this;
};

Util.inherits(BrokerV2, Events.EventEmitter);

/**
 * Will shutdown the server gracefully.
 *
 * @this {BrokerV2}
 * @callback {Error}
 */
BrokerV2.prototype.stop = function (cb) {
    var broker = this;

    if (broker.restServer) {
        broker.restServer.close();
    }

    broker.log.info('Broker has shut down.');

    return (cb ? cb() : null);
};

/**
 * This is the main entry point to start the broker, after the constructor
 * has been instantiated.
 *
 * @this {BrokerV2}
 * @callback {Error}
 */
BrokerV2.prototype.start = function (cb) {

    var broker = this;

    broker.startRestServer( function (err, server) {
        if (err) {
            throw new Error('Broker REST server failed to start: ' + err);
        }
        broker.restServer = server;

        broker.initPeriodicJobs();
        broker.emit('start');
        broker.log.info('Broker now started with PID: ' + process.pid);
        broker.db.getAllInstances(function (err, instances) {
            broker.log.info('There are ' + instances.length + ' service instances registered on this node');
        });
        return (cb ? cb(err) : err);
    });
};

/**
 * Starts the REST API server that the cloud controller will use
 * to communicate {un}provisioning/{un}binding requests.
 *
 * See also, Restify on NPM.
 *
 * @this {BrokerV2}
 * @callback {Error, RestifyServer}
 */
BrokerV2.prototype.startRestServer = function (cb) {

    var broker = this;
    var versionNS = '/v' + broker.opts.semver.major;

    var server = Restify.createServer({
        name: broker.opts.name,
        version: broker.opts.apiVersion
    });

    server.use(RestifyMiddleware.validateAPIVersion(broker.opts.semver));
    server.use(Restify.authorizationParser());
    server.use(Handlers.authenticate(broker));
    server.use(Restify.acceptParser(server.acceptable));
    server.use(Restify.queryParser());
    server.use(Restify.bodyParser());
    server.use(RestifyMiddleware.requestLogger({
        prefix: 'HTTP Request'
    }));

    // Catalog
    server.get(versionNS + '/catalog', function (req, res, next) {
        Handlers.handleCatalogRequest(broker, req, res, next);
    });

    // Provision
    server.put(versionNS + '/service_instances/:id', function (req, res, next) {
        Handlers.handleProvisionRequest(broker, req, res, next);
    });

    // Unprovision
    server.del(versionNS + '/service_instances/:id', function (req, res, next) {
        Handlers.handleUnProvisionRequest(broker, req, res, next);
    });

    // Bind
    server.put(versionNS + '/service_instances/:instance_id/service_bindings/:id', function (req, res, next) {
        Handlers.handleBindRequest(broker, req, res, next);
    });

    // Unbind
    server.del(versionNS + '/service_instances/:instance_id/service_bindings/:id', function (req, res, next) {
        Handlers.handleUnbindRequest(broker, req, res, next);
    });

    server.listen(broker.opts.port, function() {
        broker.opts.port = Url.parse(server.url).port;
        broker.restServer = server;
        broker.log.info('%s broker is listening at %s', server.name, server.url);
        cb(null, server);
    });
};

/**
 * Sets up background jobs to run at predefined intervals.
 *
 * @this {BrokerV2}
 */
BrokerV2.prototype.initPeriodicJobs = function() {};

module.exports = BrokerV2;
