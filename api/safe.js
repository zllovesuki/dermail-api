var express = require('express'),
	router = express.Router(),
	request = require('request')
	http = require('http'),
	util = require('util'),
	helper = require('../lib/helper'),
	crypto = require('crypto'),
	emptyGif = new Buffer('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
	redirect = "<html><head></head><body><script type='text/javascript'>window.location.href='%s'</script></body></html>",
	Exception = require('../lib/error');

router.get('/inline/*', function(req, res, next) {

	var r = req.r;

	var config = req.config;

	var cid = req.query.s || '';

	var contentId = cid.substring(4);

	r
	.table('attachments', {readMode: 'outdated'})
	.getAll(contentId, { index: 'contentId' })
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
	.then(function(results) {
		if (results.length === 0) {
			res.setHeader('content-type', 'image/gif');
			res.end(emptyGif);
		}else{
			var attachment = results[0];
			var url = 'https://' + config.s3.endpoint + '/' + config.s3.bucket + '/' + attachment.checksum + '/' + attachment.generatedFileName;
			res.redirect(url);
		}
	})
});

router.get('/image/*', function(req, res, next) {

	var url = req.query.s || '';

	request({
		url: url,
		// Some websites are really being a dick about user-agent.
		headers: {
			'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.94 Safari/537.36'
		},
		timeout: 3000,
		maxRedirects: 2
	})
	.on('error', function(err) {
		res.setHeader('content-type', 'image/gif');
		res.end(emptyGif);
	})
	.on('response', function(res) {
		delete res.headers['set-cookie'];
		delete res.headers['cache-control'];
		delete res.headers['expires'];
	})
	.pipe(res);
});

router.get('/href/*', function(req, res, next) {
	var url = req.query.s || '';
	res.send(util.format(redirect, url));
});

router.get('/raw/:accountId/:messageId', function(req, res, next) {
	var r = req.r;
	var config = req.config;
	var accountId = req.params.accountId || '';
	var messageId = req.params.messageId || '';
	return helper.auth.messageAccountMapping(r, messageId, accountId)
	.then(function(message) {
		if (typeof message.connection === 'undefined') return next(new Exception.NotFound('Sent mails do not have raw available.'));
		var tmpPath = message.connection.tmpPath;
		var hash = crypto.createHash('md5')
		hash.update(tmpPath);
		var md5 = hash.digest('hex');
		var url = 'https://' + config.s3.endpoint + '/' + config.s3.bucket + '/raw/' + md5;
		request({
			url: url,
			// Some websites are really being a dick about user-agent.
			headers: {
				'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.94 Safari/537.36'
			},
			timeout: 3000,
			maxRedirects: 2
		})
		.on('error', function(err) {
			res.setHeader('content-type', 'image/gif');
			res.end(emptyGif);
		})
		.pipe(res);
	})
	.catch(next);
});

module.exports = router;
