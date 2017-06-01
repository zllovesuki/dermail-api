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

discover().then(function(ip) {
    if (ip !== null) config.rethinkdb.host = ip;
    r.connect(config.rethinkdb).then(function(conn) {
        r.conn = conn;

    	app.use(function(req, res, next) {
            r.table('domains', {
                readMode: 'majority'
            }).run(r.conn).then(function() {
                res.status(200).send('ok')
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
