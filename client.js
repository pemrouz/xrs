module.exports = function({ 
  socket = require('nanosocket')()
} = {}){
  socket.id = 0

  const xrs = emitterify({ 
    socket
  , send: send(socket)
  , get subscriptions(){
      return values(socket.on)
        .map(d => d && d[0])
        .filter(d => d && d.type && d.type[0] == '$')
    }
  })
  
  socket
    .once('disconnected')
    .map(d => socket
      .on('connected')
      .map(reconnect(xrs))
    )

  socket
    .on('recv')
    .map(d => parse(d))
    .each(({ id, data, server }) => {
      // TODO: check/warn if no sub
      const sink = socket.on[`$${id}`] && socket.on[`$${id}`][0];

      server    ? xrs.emit('recv', { id, data, server })
    : data.exec ? data.exec(sink, data.value)
                : socket.emit(`$${id}`, data)
    })

  return xrs
}

const reconnect = xrs => () => xrs.subscriptions
  // .map(d => d.type)
  .map(({ subscription }) => xrs.socket.send(subscription))

const emitterify = require('utilise/emitterify')
    , values = require('utilise/values')
    , str = require('utilise/str')
    , { parse } = require('cryonic')

const send = (socket, type) => (data, meta) => {
  if (data instanceof window.Blob) 
    return binary(socket, data, meta)

  const id = str(++socket.id)
      , output = socket.on(`$${id}`)
      , next = (data, count = 0) => socket
          .send(output.source.subscription = str({ id, data, type }))
          .then(d => output.emit('sent', { id, count }))

  data.next 
    ? data.map(next).source.emit('start')
    : next(data)

  output
    .source
    .once('stop')
    .filter(reason => reason != 'CLOSED')
    .map(d => send(socket, 'UNSUBSCRIBE')(id)
      // TODO: also force stop on close of server created sub (?)
      .filter((d, i, n) => n.source.emit('stop', 'CLOSED'))
    )

  return output
}

const binary = (socket, blob, meta, start = 0, blockSize = 1024) => {
  const output = emitterify().on('recv')
      , next = id => () =>  
          start >= blob.size 
            ? output.emit('sent', { id })
            : ( socket.send(blob.slice(start, start += blockSize))
              , window.setTimeout(next(id))
              )

  send(socket, 'BINARY')({ size: blob.size, meta })
    .on('sent', ({ id }) => next(id)())
    .on('progress', received => output.emit('progress', { received, total: blob.size }))
    .map(output.next)
    .source
    .until(output.once('stop'))

  return output
}