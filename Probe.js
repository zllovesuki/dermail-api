var Queue = require('rethinkdb-job-queue'),
    Promise = require('bluebird'),
    r = require('rethinkdb'),
	config = require('./config'),
    bunyan = require('bunyan'),
	stream = require('gelf-stream'),
    express = require('express'),
    app = express(),
    discover = require('./lib/discover'),
	log;

if (!!config.graylog) {
	log = bunyan.createLogger({
		name: 'API-Worker-Probe',
		streams: [{
			type: 'raw',
			stream: stream.forBunyan(config.graylog.host, config.graylog.port)
		}]
	});
}else{
	log = bunyan.createLogger({
		name: 'API-Worker-Probe'
	});
}

var endpoint = false;
var endpointChanged = false;
var forceExit = false;

var lastMessage = null;

discover().then(function(ip) {
    if (ip !== null) {
        config.rethinkdb.host = ip
        endpoint = ip;
    }

    var messageQ = new Queue(config.rethinkdb, {
        name: 'healthCheckQueue'
    });

    var queueCounter = function() {
        var job = messageQ.createJob({
            type: 'test'
        }).setTimeout(1 * 60 * 1000).setRetryMax(0);
        return messageQ.addJob(job).then(function() {
            setTimeout(queueCounter, 15 * 1000);
        });
    }

    messageQ.ready().then(function() {
        return messageQ.reset();
    }).then(function() {
        r.connect(config.rethinkdb).then(function(conn) {
            r.conn = conn;

            queueCounter();

            messageQ.on('error', function(e) {
                log.error({ message: 'Error thrown from Queue', error: '[' + e.name + '] ' + e.message, stack: e.stack })
                forceExit = true;
            })

            messageQ.process(function(job, next) {
                messageQ.removeJob(job);
                lastMessage = new Date();
                next();
            })

        	app.use(function(req, res, next) {
                if (forceExit) {
                    return next(new Error('Queue error.'))
                }
                if (endpointChanged) {
                    return next(new Error('Endpoint changed.'))
                }
                discover().then(function(ip) {
                    if (endpoint !== false && ip !== endpoint) {
                        endpointChanged = true;
                        throw new Error('Endpoint changed.')
                    }
                    if (lastMessage === null) {
                        return res.status(200).send({})
                    }
                    var timeNow = new Date();
                    if (timeNow.getTime() - lastMessage.getTime() > 30 * 1000) {
                        throw new Error('Timeout!.')
                    }
                    return res.status(200).send({
                        endpoint: ip,
                        lastMessage
                    })
                }).catch(function(e) {
                    next(e)
                })
        	});

        	app.use(function(err, req, res, next) {
        		res.status(err.status || 500);
        		res.send({
        			ok: false,
        			errName: err.name,
        			message: err.message
        		});
        	});

            app.listen(1999);

            log.info('Process ' + process.pid + ' is running as an API-Worker-Probe listening on port 1999.');

        })
    })
})
