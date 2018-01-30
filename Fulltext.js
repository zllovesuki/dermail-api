var Promise = require('bluebird'),
    r = require('rethinkdb'),
    elasticsearch = require('elasticsearch'),
	config = require('./config'),
    bunyan = require('bunyan'),
	stream = require('gelf-stream'),
    discover = require('./lib/discover'),
    helper = require('./lib/helper'),
	log;

if (!!config.graylog) {
	log = bunyan.createLogger({
		name: 'API-Fulltext',
		streams: [{
			type: 'raw',
			stream: stream.forBunyan(config.graylog.host, config.graylog.port)
		}]
	});
}else{
	log = bunyan.createLogger({
		name: 'API-Fulltext'
	});
}

if (!config.elasticsearch) {
    log.info({ message: 'Elasticsearch not configured.' });
    process.exit(0);
}

var ready = false;

var accountToUserMapping = {};

discover().then(function(ip) {
    if (ip !== null) config.rethinkdb.host = ip;
    r.connect(config.rethinkdb).then(function(conn) {
        r.conn = conn;

        log.info('Process ' + process.pid + ' is running as an API-Fulltext.');

        var client = new elasticsearch.Client({
            host: config.elasticsearch + ':9200',
            requestTimeout: 1000 * 60 * 5
        });

        // Elasticsearch does not allow multiple types in one indices...

        client.count(function (error, response, status) {
            var count = response.count;

            log.info({ message: count + ' messages on Elastic' });

            r.table('messages')
            .pluck('messageId', 'from', 'to', 'cc', 'bcc', 'attachments', 'accountId', 'subject', 'text', 'html')
            .changes({
                includeInitial: true,
                includeStates: true
            })
            .run(r.conn)
            .then(function(cursor) {
                var getUserId = function(accountId) {
                    if (typeof accountToUserMapping[accountId] !== 'undefined') {
                        return Promise.resolve(accountToUserMapping[accountId])
                    }else{
                        return helper.auth.accountIdToUserId(r, accountId)
                        .then(function(userId) {
                            accountToUserMapping[accountId] = userId.toLowerCase();
                            return accountToUserMapping[accountId];
                        })
                    }
                }

                var fetchNext = function(err, result) {
                    if (err) throw err;

                    if (result.state === 'initializing') {
                        log.info({ message: 'Initializing feeds.' });
                        return cursor.next(fetchNext);
                    }
                    if (result.state === 'ready') {
                        ready = true;
                        log.info({ message: 'Feeds ready.' });
                        return cursor.next(fetchNext);
                    }

                    if (!ready) {
                        return getUserId(result.new_val.accountId).then(function(userId) {
                            return client.get({
                                index: [userId, result.new_val.accountId].join('_').toLowerCase(),
                                type: 'messages',
                                id: result.new_val.messageId,
                                _source: false
                            }, function(err, res) {
                                if (err) {
                                    if (err.message.indexOf('index_not_found_exception') !== -1) {
                                        // safely ignore
                                    }else if (res && res.found === false) {
                                        // safely ignore
                                    }else {
                                        throw err;
                                    }
                                }
                                if (res.found === true) return cursor.next(fetchNext);
                                return client.create({
                                    index: [userId, result.new_val.accountId].join('_').toLowerCase(),
                                    type: 'messages',
                                    id: result.new_val.messageId,
                                    body: result.new_val
                                }, function(error, response) {
                                    if (error) throw error;
                                    cursor.next(fetchNext);
                                })
                            })
                        })
                    }

                    if (result.new_val === null && result.old_val !== null) {
                        // delete
                        return getUserId(result.old_val.accountId).then(function(userId) {
                            return client.delete({
                                index: [userId, result.old_val.accountId].join('_').toLowerCase(),
                                type: 'messages',
                                id: result.old_val.messageId
                            }, function(error, response) {
                                if (error) throw error;
                                cursor.next(fetchNext);
                            })
                        })
                    }
                    if (result.new_val !== null && result.old_val !== null) {
                        // update
                        // `messages` doesn't really update (subject, text, html)
                        return cursor.next(fetchNext);
                    }
                    if (result.new_val !== null && result.old_val === null) {
                        // create
                        return getUserId(result.new_val.accountId).then(function(userId) {
                            return client.create({
                                index: [userId, result.new_val.accountId].join('_').toLowerCase(),
                                type: 'messages',
                                id: result.new_val.messageId,
                                body: result.new_val
                            }, function(error, response) {
                                if (error) throw error;
                                cursor.next(fetchNext);
                            })
                        })
                    }
            	}
            	cursor.next(fetchNext);
            })
            .catch(function(e) {
                log.error({ message: 'Error thrown from Fulltext', error: '[' + e.name + '] ' + e.message, stack: e.stack })
                process.exit(1)
            })
        })
    })
})
