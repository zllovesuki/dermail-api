var express = require('express'),
	router = express.Router(),
	validator = require('validator'),
	config = require('../config'),
	_ = require('lodash'),
	moment = require('moment-timezone'),
	helper = require('../lib/helper'),
	Promise = require('bluebird'),
	unNeededFields = [
		'showMore',
		'toBox',
		'recipients',
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

	if (compose.recipients.to.length === 0) {
		return next(new Exception.BadRequest('At least one "to" recipient is required.'));
	}

	delete compose.to;
	delete compose.cc;
	delete compose.bcc; // Better safe than sorry

	compose.html = compose.html || '';

	// Reply speicifc
	if ( (compose.type === 'reply' || compose.type === 'forward') && !!!compose.inReplyTo) {
		return next(new Exception.BadRequest('"inReplyTo" field is required for replying/forwarding.'))
	}

	var constructor = Promise.method(function() {

	});

	var actual = function() {
		return Promise.map(Object.keys(compose.recipients), function(each) {
			return Promise.map(compose.recipients[each], function(recipient) {
				if (!validator.isEmail(recipient.address)) {
					throw new Exception.BadRequest('Invalid email: ' + recipient.address);
				}
			}, { concurrency: 3 })
		}, { concurrency: 3 })
		.then(function() {
			return helper.auth.userAccountMapping(r, userId, accountId)
		})
		.then(function(account) {
			var sender = {};
            sender.address = account['account'] + '@' + account['domain'];
            return helper.address.getAddress(r, sender.address, accountId, {empty: true})
            .then(function(_sender) {
                if (_sender.hasOwnProperty('empty'))
                    sender.name = req.user.firstName + ' ' + req.user.lastName;
                else
                    sender.name = _sender.friendlyName;

    			return helper.dkim.getDKIMGivenAccountId(r, userId, accountId)
    			.then(function(dkim) {
    				if (typeof dkim[0].dkim !== 'object') {
    					// DKIM is not setup
    					compose.dkim = false;
    				}else{
    					compose.dkim = dkim[0].dkim;
    					compose.dkim.domain = dkim[0].domain;
    				}
    				return queueToTX(r, config, sender, account.accountId, userId, compose, messageQ)
    			})
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

				var name = obj.friendlyName;
				var email = obj.account + '@' + obj.domain;

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

					var name = obj.friendlyName;
					var email = obj.account + '@' + obj.domain;

					compose.addHTML = '<div class="dermail_extra"><br>' +
						'<div class="dermail_quote">---------- Forwarded message ----------<br>' +
						'From: ' + (name.length > 0 ? name + ' ' : '') + '&lt;<a href="mailto:' + email + '" target="_blank">' + email + '</a>&gt;<br>'+
						'Date: ' + date + '<br>' +
						'Subject: ' + original.subject + '<br>' +
						'To: ' + '<a href="mailto:' + email + '" target="_blank">' + name + '</a><br><br><br>'+
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
		account: email.address.substring(0, email.address.lastIndexOf("@")).toLowerCase(),
		domain: email.address.substring(email.address.lastIndexOf("@") +1).toLowerCase(),
		friendlyName: email.name
	}
}

var checkForInReplyTo = function(r, _messageId) {
	return r
	.table('messages', { readMode: 'majority' })
	.getAll(_messageId, { index: '_messageId' })
	.map(function(d) {
		return d.merge(function(doc) {
			return {
				'to': doc('to').concatMap(function(to) { // It's like a subquery
					return [r.table('addresses', {readMode: 'majority'}).get(to).without('accountId', 'addressId', 'internalOwner')]
				}),
				'from': doc('from').concatMap(function(from) { // It's like a subquery
					return [r.table('addresses', {readMode: 'majority'}).get(from).without('accountId', 'addressId', 'internalOwner')]
				})
			}
		})
	})
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
}

var queueToTX = Promise.method(function(r, config, sender, accountId, userId, compose, messageQ) {
	var recipients = _.cloneDeep(compose.recipients);
	compose.from = sender;
	compose.userId = userId;
	compose.accountId = accountId;
	unNeededFields.forEach(function(field) {
		delete compose[field];
	})
	_.merge(compose, recipients);
	return messageQ.add({
		type: 'queueTX',
		payload: compose
	}, config.Qconfig)
})

module.exports = router;
