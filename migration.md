## Migration

4.x -> 5.0

```javascript
r.db('dermail').table('addresses').filter(function(doc) {
  return r.not(doc('internalOwner').eq(null))
}).forEach(function(doc) {
  return r.db('dermail').table('accounts')
    .get(doc('accountId'))
    .update(function(row) {
      return {
        addresses: r.branch(row.hasFields('addresses'), row('addresses').append({
          name: doc('friendlyName'),
          address: r.add(doc('account'), '@', doc('domain')),
          isAlias: doc.hasFields('aliasOf')
        }), [{
          name: doc('friendlyName'),
          address: r.add(doc('account'), '@', doc('domain')),
          isAlias: doc.hasFields('aliasOf')
        }])
      }
    })
})
```

```javascript
r.db('dermail').table('accounts').indexCreate('friendlyName', r.row('addresses')('name'), {multi: true})
r.db('dermail').table('accounts').indexCreate('addresses', r.row('addresses')('address'), {multi: true})
```

```javascript
r.expr([
    'from',
    'to',
    'cc',
    'bcc'
]).forEach(function(type) {
    return r.db('dermail').table('messages').indexCreate(r.add(type, 'Name'), function(row) {
        return row(type)('name')
    }, {
        multi: true
    })
})
```
