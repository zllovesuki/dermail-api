var r = require('rethinkdb'),
    config = require('./config'),
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

r.connect(config.rethinkdb).then(function(conn) {
    setInterval(function() {
        var now = new Date();
        var time = Math.round(now.setHours(now.getHours() - 6) / 1000);
        r.table('greylist')
        .between(r.minval, time, {index: 'lastSeen'})
        .filter(function(doc) {
            return doc('whitelisted').eq(false)
        })
        .delete()
        .run(conn, {
            readMode: 'majority'
        })
        .then(function(result) {
            log.info('Deleted %d expired greylist', result.deleted);
        })
    }, 6 * 60 * 60 * 1000) // every 6 hours
    log.info('Process ' + process.pid + ' is running to clean up expired greylist every 6 hours.')
})
