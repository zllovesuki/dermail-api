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
    .merge(function(doc) {
        return {
            'to': doc('to').concatMap(function(to) {
                return [r.table('addresses').get(to).without('accountId', 'addressId', 'internalOwner')]
            }),
            'from': doc('from').concatMap(function(from) {
                return [r.table('addresses').get(from).without('accountId', 'addressId', 'internalOwner')]
            }),
            'cc': doc('cc').concatMap(function(cc) {
                return [r.table('addresses').get(cc).without('accountId', 'addressId', 'internalOwner')]
            }),
            'bcc': doc('bcc').concatMap(function(bcc) {
                return [r.table('addresses').get(bcc).without('accountId', 'addressId', 'internalOwner')]
            }),
            'headers': r.table('messageHeaders').get(doc('headers')).pluck('sender', 'x-beenthere', 'x-mailinglist'),
            'attachments': doc('attachments').concatMap(function(attachment) {
                return [r.table('attachments').get(attachment)]
            })
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
        ]).spread(function(ownAddresses, lastTrainedMailWasSavedOn) {
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
