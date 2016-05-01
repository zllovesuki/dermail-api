module.exports = function(r) {
	var express = require('express'),
		path = require('path'),
		logger = require('morgan'),
		bodyParser = require('body-parser'),
		passport = require('passport'),
		config = require('./config'),
		cors = require('cors'),
		jwt = require('jwt-simple'),
		Queue = require('bull'),
		app = express(),
		RateLimit = require('express-rate-limit'),
		rx = require('./api/rx'),
		authentication = require('./api/authentication'),
		read = require('./api/read'),
		write = require('./api/write'),
		relay = require('./api/relay'),
		safe = require('./api/safe');

	if (process.env.RDB_HOST) app.use(logger('dev'));
	app.use(bodyParser.json({limit: '100mb'}));
	app.use(bodyParser.urlencoded({ extended: true, limit: '100mb' }));
	app.use(passport.initialize());

	if (!!config.behindProxy) {
		app.enable('trust proxy');
		app.set('trust proxy', 'loopback, linklocal, uniquelocal');
	}

	require('./lib/auth')(config, passport, r);

	app.use(express.static(path.join(__dirname, 'public')));

	app.use(cors({
		maxAge: 86400
	}));

	var messageQ = new Queue('dermail-api-worker', config.redisQ.port, config.redisQ.host);

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

	app.use(version + '/login', loginLimiter, authentication);
	app.use(version + '/rx', rx);

	app.use(version + '/read', read);
	app.use(version + '/write', write);

	app.use(version + '/relay', relay);
	app.use(version + '/safe', safe);

	// catch 404 and forward to error handler
	app.use(function(req, res, next) {
	  var err = new Error('Not Found');
	  err.status = 404;
	  next(err);
	});

	// error handlers

	// development error handler
	// will print stacktrace
	if (app.get('env') === 'development') {
	  app.use(function(err, req, res, next) {
	    res.status(err.status || 500);
		res.send({
			message: err.message,
			error: err
	    });
	  });
	}

	// production error handler
	// no stacktraces leaked to user
	app.use(function(err, req, res, next) {
	  res.status(err.status || 500);
	  res.send({
		  message: err.message,
		  error: {}
	  });
	});

	return app;
};
