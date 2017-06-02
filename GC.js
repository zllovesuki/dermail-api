var r = require('rethinkdb'),
    config = require('./config'),
    discover = require('./lib/discover'),
    log;

if (!!config.graylog) {
    log = require('bunyan').createLogger({
        name: 'API-GC',
        streams: [{
            type: 'raw',
            stream: require('gelf-stream').forBunyan(config.graylog.host, config.graylog.port)
        }]
    });
}else{
    log = require('bunyan').createLogger({
        name: 'API-GC'
    });
}

discover().then(function(ip) {
    if (ip !== null) config.rethinkdb.host = ip;
    r.connect(config.rethinkdb).then(function(conn) {
        log.info('Process ' + process.pid + ' is running to clean up expired greylist every 6 hours.')
        var doClean = function() {
            var nowPending = new Date();
            var nowWhitelisted = new Date();
            // 6 hours expiration
            var pending = Math.round(nowPending.setHours(nowPending.getHours() - 6) / 1000);
            // 30 days expiration
            var whitelisted = Math.round(nowWhitelisted.setDate(nowWhitelisted.getDate() - 30) / 1000);
            return Promise.all([
                r.table('greylist')
                .between(r.minval, pending, {index: 'lastSeen'})
                .filter(function(doc) {
                    return doc('whitelisted').eq(false)
                })
                .delete()
                .run(conn, {
                    readMode: 'majority'
                })
                .then(function(result) {
                    log.info('Deleted %d expired greylist', result.deleted);
                }),
                r.table('greylist')
                .between(r.minval, whitelisted, {index: 'lastSeen'})
                .filter(function(doc) {
                    return doc('whitelisted').eq(true)
                })
                .delete()
                .run(conn, {
                    readMode: 'majority'
                })
                .then(function(result) {
                    log.info('Deleted %d expired whitelist', result.deleted);
                })
            ])
        }
        var clean = function() {
            return doClean().then(function() {
                setTimeout(function() {
                    clean()
                }, 6 * 60 * 60 * 1000) // every 6 hours
            })
        }
        clean()
    })
})
