// Inspired from https://github.com/socketio/chat-example

'use strict'

const { serve } = require('..')

function socket (eventEmitter) {
  eventEmitter.on('server-created', ({ server }) => {
    console.log('server-created')
    socket.io = require('socket.io')(server)

    socket.io.on('connection', connection => {
      connection.on('chat message', msg => {
        socket.io.emit('chat message', msg)
      })
    })
  })
}

function html (content, request, response) {
  response.writeHead(200, {
    'Content-Type': 'text/html',
    'Content-Legth': content.length
  })
  response.end(content)
}

serve({
  port: 8081,
  listeners: [socket],
  mappings: [{
    match: /^\/$/,
    custom: html.bind(null, `<!doctype html>
<html>
  <head>
    <title>Socket.IO chat</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font: 13px Helvetica, Arial; }
      form { background: #000; padding: 3px; position: fixed; bottom: 0; width: 100%; }
      form input { border: 0; padding: 10px; width: 90%; margin-right: .5%; }
      form button { width: 9%; background: rgb(130, 224, 255); border: none; padding: 10px; }
      #messages { list-style-type: none; margin: 0; padding: 0; }
      #messages li { padding: 5px 10px; }
      #messages li:nth-child(odd) { background: #eee; }
      #messages { margin-bottom: 40px }
    </style>
  </head>
  <body>
    <ul id="messages"></ul>
    <form action="">
      <input id="m" autocomplete="off" /><button>Send</button>
    </form>
    <script src="/socket.io/socket.io.js"></script>
    <script src="https://code.jquery.com/jquery-1.11.1.js"></script>
    <script>
      $(function () {
        var socket = io();
        $('form').submit(function(){
          socket.emit('chat message', $('#m').val());
          $('#m').val('');
          return false;
        });
        socket.on('chat message', function(msg){
          $('#messages').append($('<li>').text(msg));
          window.scrollTo(0, document.body.scrollHeight);
        });
      });
    </script>
  </body>
</html>`)
  }]
})
  .on('ready', ({ url }) => {
    console.log(`Server running at ${url}`)
  })
