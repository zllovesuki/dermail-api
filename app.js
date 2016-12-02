module.exports = function(r) {
	var express = require('express'),
		path = require('path'),
		bodyParser = require('body-parser'),
		jsonParser = bodyParser.json({limit: '55mb'}),
		passport = require('passport'),
		config = require('./config'),
		cors = require('cors'),
		jwt = require('jwt-simple'),
        Queue = require('rethinkdb-job-queue'),
		app = express(),
		RateLimit = require('express-rate-limit'),
		rx = require('./api/rx'),
		authentication = require('./api/authentication'),
		read = require('./api/read'),
		write = require('./api/write'),
		relay = require('./api/relay'),
		upload = require('./api/upload'),
		safe = require('./api/safe');

	app.use(passport.initialize());

	if (!!config.behindProxy) {
		app.enable('trust proxy');
		app.set('trust proxy', 'loopback, linklocal, uniquelocal');
	}

	if (!!config.graylog) {
		app.use(require('express-bunyan-logger')({
			name: 'API',
			streams: [{
				type: 'raw',
				stream: require('gelf-stream').forBunyan(config.graylog.host, config.graylog.port)
			}]
		}));
	}else{
		app.use(require('express-bunyan-logger')({
			name: 'API'
		}));
	}

	require('./lib/auth')(config, passport, r);

	app.use(express.static(path.join(__dirname, 'public')));

	app.use(cors({
		maxAge: 86400
	}));

    var messageQ = new Queue(config.rethinkdb, {
        name: 'jobQueue',
        // Default with concurrency of 2
        concurrency: 2,
        // This is not a master queue
        masterInterval: false
    });

    messageQ.jobOptions = {
        retryMax: 50,
        retryDelay: 2 * 1000,
        timeout: 5 * 60 * 1000
    }

	app.use(function(req, res, next){
		req.r = r;
		req.Q = messageQ;
		req.config = config;
		next();
	});

	var loginLimiter = new RateLimit({
		windowMs: 60 * 60 * 1000, // 1 hour window
		delayAfter: 3, // begin slowing down responses after three requests
		delayMs: 3 * 1000, // slow down subsequent responses by 3 seconds per request
		max: 10, // start blocking after 10 requests
		message: "Too many login attempts from this IP, please try again after an hour."
	});

	var version = '/v' + config.apiVersion;

	app.use(version + '/login', loginLimiter, jsonParser, authentication);
	app.use(version + '/rx', jsonParser, rx);

	app.use(version + '/read', jsonParser, read);
	app.use(version + '/write', jsonParser, write);

	app.use(version + '/relay', jsonParser, relay);
	app.use(version + '/upload', upload);
	app.use(version + '/safe', safe);

	// catch 404 and forward to error handler
	app.use(function(req, res, next) {
		res.status(200).send({ok: true, message: 'Dermail API v2'});
	});

	// production error handler
	// no stacktraces leaked to user
	app.use(function(err, req, res, next) {
		req.log.error(err);
		res.status(err.status || 500);
		res.send({
			ok: false,
			errName: err.name,
			message: err.message
		});
	});

	return app;
};
