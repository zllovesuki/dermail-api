var Promise = require('bluebird'),
    r = require('rethinkdb'),
    _ = require('lodash'),
	config = require('../config'),
	request = require('superagent'),
	crypto = require('crypto'),
	dkim = require('../lib/haraka/dkim'),
	SPF = require('../lib/haraka/spf').SPF,
    MailParser = require('mailparser').MailParser;

var onS3 = {};
var inDB = {};
var raw = {};
var connections = {};

r.connect(config.rethinkdb).then(function(conn) {
    r.conn = conn;

    r.table('messages')
    .pluck('connection', 'messageId')
    .run(r.conn)
    .then(function(cursor) {
        return cursor.toArray();
    })
    .then(function(results) {
        return results.map(function(res) {
            if (res.connection) {
                var tmpPath = res.connection.tmpPath;
                var hash = crypto.createHash('md5')
                hash.update(tmpPath);
                var md5 = hash.digest('hex');
                return {
                    connection: res.connection,
                    messageId: res.messageId,
                    checksum: md5
                }
            }
        })
    })
    .then(function(results) {
        return Promise.map(results, function(res) {
            if (!res) return;
            return new Promise(function(resolve, reject) {
                var mailParser = new MailParser({
                    streamAttachments: true
                });

                mailParser.on('end', function (mail) {
                    if (res.connection) {
                        mail._date = _.clone(mail.date);
                        mail.date = res.connection.date;
                    }

                    mail.to = mail.to || [];
            		mail.from = mail.from || [];
            		mail.cc = mail.cc || [];
            		mail.bcc = mail.bcc || [];
                    return r.table('messages')
                    .get(res.messageId)
                    .update({
                        to: mail.to,
                        from: mail.from,
                        cc: mail.cc,
                        bcc: mail.bcc
                    })
                    .run(r.conn)
                    .then(resolve)
                })

                request.get([
                    'https://',
                    config.s3.endpoint,
                    '/',
                    config.s3.bucket,
                    '/raw/',
                    res.checksum
                ].join('')).pipe(mailParser);
            });
        }, { concurrency: 5 })
    })
    .then(function() {
        r.conn.close();
    })
})
