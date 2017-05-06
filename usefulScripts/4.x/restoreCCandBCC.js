var r = require('rethinkdb'),
    Promise = require('bluebird'),
	config = require('../config'),
    helper = require('../lib/helper'),
    crypto = require('crypto'),
    request = require('superagent'),
    MailParser = require('mailparser').MailParser,
    _ = require('lodash');

r.connect(config.rethinkdb).then(function(conn) {
    r.conn = conn;
    r.table('messages')
    .pluck('messageId', 'accountId', 'connection', 'cc', 'bcc')
    .map(function(row) {
        return row.merge(function(doc) {
            return {
                cc: r.branch(doc.hasFields('cc'), doc('cc'), []),
                bcc: r.branch(doc.hasFields('bcc'), doc('bcc'), [])
            }
        })
    })
    .map(function(row) {
        return row.merge(function(doc) {
            return {
                'cc': doc('cc').concatMap(function(cc) { // It's like a subquery
                    return [r.table('addresses', {
                        readMode: 'majority'
                    }).get(cc)]
                }),
                'bcc': doc('bcc').concatMap(function(bcc) { // It's like a subquery
                    return [r.table('addresses', {
                        readMode: 'majority'
                    }).get(bcc)]
                })
            }
        })
    })
    .filter(function(row) {
        return row('cc').count().gt(0).or(row('bcc').count().gt(0))
    })
    .run(r.conn)
    .then(function(cursor) {
        return cursor.toArray();
    })
    .then(function(results) {
        return results.filter(function(doc) {
            return doc.cc.indexOf(null) > -1 || doc.bcc.indexOf(null) > -1
        }).map(function(doc) {
            if (doc.connection) {
                doc.hash = crypto.createHash('md5').update(doc.connection.tmpPath).digest('hex');
                delete doc.connection
            }
            return doc
        })
    })
    .then(function(results) {
        return Promise.map(results, function(result) {
            return parse(result.hash).then(function(mail) {
                return Promise.join(
                    helper.address.getArrayOfAddress(r, result.accountId, mail.cc),
                    helper.address.getArrayOfAddress(r, result.accountId, mail.bcc),
                    function(ccAddr, bccAddr) {
                        return r.table('messages').get(result.messageId).update({
                            cc: ccAddr,
                            bcc: bccAddr
                        }).run(r.conn)
                    }
                )
            })
        })
    })
    .then(function() {
        conn.close()
    })
})


var parse = function(hash) {
    return new Promise(function(resolve, reject) {
        var mailParser = new MailParser({
            streamAttachments: true
        });

        var url = 'https://' + config.s3.bucket + '.' + config.s3.endpoint + '/raw/' + hash;

        mailParser.on('error', function(e) {
            return reject(e);
        });

        mailParser.on('end', function (mail) {

            if (!mail.text && !mail.html) {
                mail.text = '';
                mail.html = '<div></div>';
            } else if (!mail.html) {
                mail.html = helper.parse.convertTextToHtml(mail.text);
            } else if (!mail.text) {
                mail.text = helper.parse.convertHtmlToText(mail.html);
            }

            mail.cc = mail.cc || [];
            mail.attachments = mail.attachments || [];

            return resolve(mail)
        });

        var readStream = request.get(url);
        readStream.on('error', function(e) {
            return reject(e);
        })

        readStream.pipe(mailParser);
    });
}
