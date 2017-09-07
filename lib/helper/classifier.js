var Promise = require('bluebird');

var self = module.exports = {
    checkAccount: function(r, accountId, skipCount) {
        skipCount = (skipCount === true);
        return Promise.all([
            r.table('messages')
            .getAll(accountId, { index: 'accountId' })
            .count()
            .run(r.conn),
            r.tableList()
            .contains(accountId + 'Store')
            .run(r.conn),
            r.table('accounts')
            .get(accountId)
            .run(r.conn)
            .then(function(account) {
                return account.bayesEnabled
            })
        ]).spread(function(mailCount, exist, enabled) {
            // the filter needs at least 50 mails to be effective
            if (skipCount) return exist === true && enabled === true
            else return mailCount > 50 && exist === true && enabled === true
        })
    },
    getLastTrainedMailWasSavedOn: function(r, accountId) {
        return r.table(accountId + 'Store')
        .get('lastTrainedMailWasSavedOn')
        .run(r.conn)
        .then(function(last) {
            if (last === null) {
                return null;
            }
            return last.value;
        })
        .catch(function(e) {
            return null;
        })
    },
    getOwnAddresses: function(r, accountId) {
        return r.table('accounts')
        .get(accountId)
        .merge(function(z) {
            return {
                addresses: r.branch(z.hasFields('addresses'), z('addresses')('address'), [])
            }
        })
        .run(r.conn)
        .then(function(result) {
            return result.addresses.map(function(addr) {
                return addr.toLowerCase();
            })
        })
    },
    acquireLock: function(r, timestamp, accountId) {
        return r.table(accountId + 'Store')
        .insert({
            key: 'trainLock',
            value: typeof timestamp === 'undefined' ? true : timestamp
        }, {
            conflict: 'error'
        })
        .run(r.conn)
        .then(function(result) {
            if (result.errors > 0) return false;
            return true;
        })
        .catch(function(e) {
            return false;
        })
    },
    releaseLock: function(r, accountId) {
        return r.table(accountId + 'Store')
        .get('trainLock')
        .delete()
        .run(r.conn)
        .then(function(result) {
            if (result.errors > 0) return false;
            return true;
        })
        .catch(function(e) {
            return false;
        })
    },
    dne: function(r, userId) {
        return require('./notification').sendAlert(r, userId, 'error', 'Filter needs to be trained initially.')
    }
}
