var self = module.exports = {
    getLastTrainedMailWasSavedOn: function(r) {
        return r.table('bayesStore')
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
    getOwnAddresses: function(r) {
        return r.table('addresses')
        .pluck('account', 'domain', 'internalOwner')
        .run(r.conn)
        .then(function(cursor) {
            return cursor.toArray();
        })
        .then(function(addresses) {
            return addresses.filter(function(addr) {
                return addr.internalOwner !== null;
            })
            .map(function(addr) {
                return {
                    //name: addr.friendlyName,
                    address: [addr.account, addr.domain].join('@')
                }
            })
            .map(function(obj) {
                return obj.address.toLowerCase();
            })
        })
    },
    acquireLock: function(r) {
        return r.table('bayesStore')
        .insert({
            key: 'trainLock',
            value: true
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
    releaseLock: function(r) {
        return r.table('bayesStore')
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
