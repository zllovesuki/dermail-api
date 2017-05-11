var config = require('../config'),
    Promise = require('bluebird'),
    r = require('rethinkdb'),
    classifier = require('dermail-spam'),
    helper = require('../lib/helper');

r.connect(config.rethinkdb).then(function(conn) {
    r.conn = conn;
    r.table('messages')
    .get(process.argv[2])
    .merge(function(doc) {
        return {
            cc: r.branch(doc.hasFields('cc'), doc('cc'), []),
            bcc: r.branch(doc.hasFields('bcc'), doc('bcc'), []),
            replyTo: r.branch(doc.hasFields('replyTo'), doc('replyTo'), [])
        }
    })
    .run(r.conn, {
        readMode: 'majority'
    })
    .then(function(message) {
        return Promise.all([
            classifier.init(r.conn),
            helper.classifier.getOwnAddresses(r),
            helper.classifier.getLastTrainedMailWasSavedOn(r)
        ]).spread(function(nullValue, ownAddresses, lastTrainedMailWasSavedOn) {
            if (lastTrainedMailWasSavedOn === null) return null;

            return classifier.categorize(message, ownAddresses, true)
        }).then(function(probs) {
            console.log(probs);
        })
    })
    .then(function() {
        r.conn.close()
    })
})
