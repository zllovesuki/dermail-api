var Promise = require('bluebird'),
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

var lastConnected = false;
var lastConnectedChanged = false;

discover().then(function(ip) {
    if (ip !== null) {
        config.rethinkdb.host = ip;
        endpoint = ip;
    }

    r.connect(config.rethinkdb).then(function(conn) {
        r.conn = conn;

        /*
            We are only checking data servers but not proxy. Proxy disconnection is handled by endpointChanged
        */
        var compareTimeConnected = function() {
            return r.db('rethinkdb').table('server_status').pluck({
                'id': true,
                'network': {
                    'time_connected': true
                }
            })
            .run(r.conn)
            .then(function(cursor) {
                return cursor.toArray()
            })
            .then(function(results) {
                var now = results.map(function(result) {
                    return result.id + ':' + result.network.time_connected;
                }).join(';')
                if (lastConnected === false) {
                    lastConnected = now;
                }
                if (now !== lastConnected) {
                    lastConnectedChanged = true;
                }
                setTimeout(compareTimeConnected, 1000 * 15);
            })
        }

        compareTimeConnected()

        app.use(function(req, res, next) {
            if (lastConnectedChanged) {
                return next(new Error('Configuration changed.'))
            }
            if (endpointChanged) {
                return next(new Error('Endpoint changed.'))
            }
            discover().then(function(ip) {
                if (endpoint !== false && ip !== endpoint) {
                    endpointChanged = true;
                    throw new Error('Endpoint changed.')
                }
                return res.status(200).send({
                    endpoint: ip,
                    lastConnected: lastConnected
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
    });
})
