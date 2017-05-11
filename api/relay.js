var Promise = require('bluebird'),
    express = require('express'),
	router = express.Router(),
	validator = require('validator'),
	config = require('../config'),
	_ = require('lodash'),
	moment = require('moment-timezone'),
	helper = require('../lib/helper'),
	unNeededFields = [
		'showMore',
		'toBox',
		'addresses',
		'type'
	],
	Exception = require('../lib/error');

var auth = helper.auth.middleware;

router.post('/sendMail', auth, function(req, res, next) {

	var r = req.r;
	var config = req.config;
	var messageQ = req.Q;

	var userId = req.user.userId;
	var compose = req.body;
	var accountId = req.body.accountId;

	if (req.user.accounts.indexOf(compose.accountId) === -1) {
		return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
	}

	if (compose.addresses.to.length === 0) {
		return next(new Exception.BadRequest('At least one "to" recipient is required.'));
	}

	compose.html = compose.html || '';

	// Reply speicifc
	if ( (compose.type === 'reply' || compose.type === 'forward') && !!!compose.inReplyTo) {
		return next(new Exception.BadRequest('"inReplyTo" field is required for replying/forwarding.'))
	}

	var constructor = Promise.resolve;

	var actual = function() {
        return (Promise.method(function() {
            Object.keys(compose.addresses).forEach(function(each) {
                if (typeof compose.addresses[each].address !== 'undefined') {
                    if (!validator.isEmail(compose.addresses[each].address)) {
    					throw new Exception.BadRequest('Invalid email: ' + compose.addresses[each].address);
    				}
                }else{
                    compose.addresses[each].forEach(function(recipient) {
                        if (!validator.isEmail(recipient.address)) {
        					throw new Exception.BadRequest('Invalid email: ' + recipient.address);
        				}
                    })
                }
            })
        }))()
		.then(function() {
			return helper.auth.userAccountMapping(r, userId, accountId)
		})
		.then(function(account) {
            // TODO: check again for security reasons
            // check for alias status as well
            var sender = compose.addresses.sender;

            return helper.dkim.getDKIMGivenAccountId(r, userId, accountId)
            .then(function(dkim) {
                if (typeof dkim[0].dkim !== 'object' || compose.addresses.sender.isAlias) {
                    // DKIM is not setup
                    compose.dkim = false;
                }else{
                    compose.dkim = dkim[0].dkim;
                    compose.dkim.domain = dkim[0].domain;
                }
                return queueToTX(r, config, sender, account.accountId, userId, compose, messageQ)
            })
		})
	}

	return constructor()
	.then(function() {
		if (compose.type !== 'new') {
			return checkForInReplyTo(r, compose.inReplyTo)
			.then(function(results) {
				if (results.length === 0) {
					throw new Exception.BadRequest('"inReplyTo" points to a non-existent message.');
				}
				var original = results[0];
				var obj;
				var html;

				compose.references.push(compose.inReplyTo);

                if (typeof original.replyTo !== 'undefined') {
					obj = emailToObject(original.replyTo[0]);
				}else{
					obj = original.from[0];
				}

				var name = obj.name;
				var email = obj.address;

				//var body = original.html.match(/^\s*(?:<(?:!(?:(?:--(?:[^-]+|-[^-])*--)+|\[CDATA\[(?:[^\]]+|](?:[^\]]|][^>]))*\]\]|[^<>]+)|(?!body[\s>])[a-z]+(?:\s*(?:[^<>"']+|"[^"]*"|'[^']*'))*|\/[a-z]+)\s*>|[^<]+)*\s*<body(?:\s*(?:[^<>"']+|"[^"]*"|'[^']*'))*\s*>([\s\S]+)<\/body\s*>/i);
				// Jesus... Regex from http://stackoverflow.com/questions/1207975/regex-to-match-contents-of-html-body

				var body = /<body[^>]*>([^<]*(?:(?!<\/?body)<[^<]*)*)<\/body\s*>/i.exec(original.html);
				// http://stackoverflow.com/questions/6609903/using-javascript-and-regular-expression-to-get-content-inside-the-html-body
				if (body) {
					html = body[1];
				}else{
					html = original.html;
				}

				var date = moment(original.date).tz('UTC').format("ddd, MMM D, YYYY [at] hh:mm a z");

				switch (compose.type) {
					case 'reply':
					// Reply specificed

					compose.addHTML = '<div class="dermail_extra"><br>' +
						'<div class="dermail_quote">On ' + date +
						', ' + name + ' &lt;<a href="mailto:' + email + '" target="_blank">' + email +
						'</a>&gt; wrote: <br><blockquote class="dermail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">' +
						html + '</blockquote></div></div>';

					break;
					case 'forward':
					// Forward specificed

					var obj;

					obj = original.to[0];

                    var name = obj.name;
    				var email = obj.address;

					compose.addHTML = '<div class="dermail_extra"><br>' +
						'<div class="dermail_quote">---------- Forwarded message ----------<br>' +
						'From: ' + (name.length > 0 ? name + ' ' : '') + '&lt;<a href="mailto:' + email + '" target="_blank">' + email + '</a>&gt;<br>'+
						'Date: ' + date + '<br>' +
						'Subject: ' + original.subject + '<br>' +
						'To: ' + (name.length > 0 ? name + ' ' : '') + '<a href="mailto:' + email + '" target="_blank">' + email + '</a><br><br><br>'+
						html + '</div></div>';

					break;
					default:
					break;
				}
			})
		}
	})
	.then(function() {
		if (typeof compose.addHTML !== 'undefined') {
			compose.html += compose.addHTML;
			delete compose.addHTML;
		}
	})
	.then(actual)
	.then(function() {
		return res.status(200).send({});
	})
	.catch(function(err) {
		req.log.error(err);
		return next(err);
	})
});

var emailToObject = function(email) {
	return {
		address: email.address.toLowerCase(),
		name: email.name
	}
}

var checkForInReplyTo = function(r, _messageId) {
	return r
	.table('messages', { readMode: 'majority' })
	.getAll(_messageId, { index: '_messageId' })
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
}

var queueToTX = Promise.method(function(r, config, sender, accountId, userId, compose, messageQ) {
	var addresses = _.cloneDeep(compose.addresses);
    delete addresses.sender;
	compose.from = sender;
	compose.userId = userId;
	compose.accountId = accountId;
	unNeededFields.forEach(function(field) {
		delete compose[field];
	})
	_.merge(compose, addresses);
    var job = messageQ.createJob({
		type: 'queueTX',
		payload: compose
	}).setTimeout(15 * 60 * 1000).setRetryMax(50).setRetryDelay(2 * 1000)
	return messageQ.addJob(job);
})

module.exports = router;
