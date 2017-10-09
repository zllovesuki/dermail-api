var endpointChanged = false;

module.exports = function(r, ip2asn, endpoint) {
	var Promise = require('bluebird'),
        express = require('express'),
		path = require('path'),
		bodyParser = require('body-parser'),
		jsonParser = bodyParser.json({limit: '55mb'}),
		passport = require('passport'),
		config = require('./config'),
		cors = require('cors'),
		jwt = require('jwt-simple'),
        Queue = require('rethinkdb-job-queue'),
		app = express(),
        discover = require('./lib/discover'),
		rx = require('./api/rx'),
        elasticsearch = require('elasticsearch'),
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
        // This is not a master queue
        masterInterval: false,
        changeFeed: false
    });

	app.use(function(req, res, next){
		req.r = r;
		req.Q = messageQ;
		req.config = config;
        req.ip2asn = ip2asn;
        if (!config.elasticsearch) {
            req.elasticsearch = null
        }else{
            req.elasticsearch = new elasticsearch.Client({
                host: config.elasticsearch + ':9200',
                requestTimeout: 1000 * 60 * 5
            });
        }
		next();
	});

    app.use('/healthz', function(req, res, next) {
        var r = req.r;
        if (endpointChanged) {
            return next(new Error('Endpoint changed.'))
        }
        Promise.all([
            discover(),
            r.table('domains', {
                readMode: 'majority'
            }).run(r.conn)
        ]).spread(function(ip, domains) {
            if (endpoint !== false && ip !== endpoint) {
                endpointChanged = true;
                throw new Error('Endpoint changed.')
            }
            return res.status(200).send('ok')
        }).catch(function(e) {
            next(e)
        })
    });

	var version = '/v' + config.apiVersion;

	app.use(version + '/login', jsonParser, authentication);
	app.use(version + '/rx', jsonParser, rx);

	app.use(version + '/read', jsonParser, read);
	app.use(version + '/write', jsonParser, write);

	app.use(version + '/relay', jsonParser, relay);
	app.use(version + '/upload', upload);
	app.use(version + '/safe', safe);

	// catch 404 and forward to error handler
	app.use(function(req, res, next) {
		res.status(200).send({ok: true, message: 'Dermail API v2 (v' + require(__dirname + '/version.json') + ')'});
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
