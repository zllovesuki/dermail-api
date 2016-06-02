var express = require('express'),
	router = express.Router(),
	request = require('request')
	http = require('http'),
	util = require('util'),
	emptyGif = new Buffer('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
	redirect = "<html><head></head><body><script type='text/javascript'>window.location.href='%s'</script></body></html>";

var replaceMap = [
	{
		from: '&#58;',
		to: ':'
	}
];

router.get('/inline/*', function(req, res, next) {

	var r = req.r;

	var config = req.config;

	var cid = req.query.s || '';

	var contentId = cid.substring(4);

	r
	.table('attachments', {readMode: 'majority'})
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
			var url = 'https://' + config.s3.bucket + '.' + config.s3.endpoint + '/' + attachment.checksum + '/' + attachment.generatedFileName;
			res.redirect(url);
		}
	})
});

router.get('/image/*', function(req, res, next) {

	var url = req.query.s || '';

	replaceMap.forEach(function(single) {
		url = url.replace(new RegExp('[' + single.from + ']', 'g'), single.to);
	})

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
});

router.get('/href/*', function(req, res, next) {
	var url = req.query.s || '';
	res.send(util.format(redirect, url));
});

module.exports = router;
