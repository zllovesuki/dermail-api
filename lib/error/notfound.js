'use strict';

module.exports = function NotFound(message, extra) {
	Error.captureStackTrace(this, this.constructor);
	this.name = this.constructor.name;
	this.status = 404;
	this.message = message;
	this.extra = extra;
};

require('util').inherits(module.exports, Error);
