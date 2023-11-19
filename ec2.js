
require("child_process").execSync(`npm install ws`, {stdio: "inherit"});
require("child_process").execSync(`npm install aws-sdk`, {stdio: "inherit"});

require('./config')

var port = 60101

main()
async function main() {
    var AWS = require('aws-sdk')
    AWS.config.credentials = new AWS.Credentials(...aws_keys)
    var s3 = new AWS.S3()

    var spawns = {}

    process.on('unhandledRejection', x => console.log(`unhandledRejection: ${x.stack}`))
    process.on('uncaughtException', x => console.log(`uncaughtException: ${x.stack}`))


    var server = require('https').createServer({
        key: require('fs').readFileSync('./privkey.pem'),
        cert: require('fs').readFileSync('./fullchain.pem')
    }, async function (req, res) {
        let msg = await new Promise(done => {
            var body = []
            req.on('data', d => body.push(d))
            req.on('end', () => done(body.join('')))
        })
        console.log(`--- got request: ${msg}`)
        try {
            cmd = JSON.parse(msg)
            if (cmd.cmd == 'eval') {
                let filename = cmd.key
    
                console.log(`downloading ${filename}..`)
                let x = await s3.getObject({Bucket: bucket, Key: filename}).promise()
    
                console.log(`saving ${filename}..`)
                require('fs').writeFileSync('./' + filename, x.Body)
    
                console.log(`running ${filename}..`)
    
                if (spawns[filename]) {
                    spawns[filename].stdout = ''
                    if (spawns[filename].process) {
                        console.log(`stopping previously running ${filename}..`)
                        if (spawns[filename].process.exitCode == null) {
                            console.log(`killing process: ${spawns[filename].process.pid}..`)
                            try {
                                process.kill(-spawns[filename].process.pid, 'SIGKILL')
                            } catch (e) {
                                console.log(`e: ${e}`)
                            }
                            console.log('..process dead')
                        } else console.log('process was already dead')
                    }
                } else spawns[filename] = {stdout: '', conns: []}

                spawns[filename].process = require('child_process').spawn('node', [filename], {detached: true})
                function on_data(chunk) {
                    chunk = '' + chunk
                    spawns[filename].conns = spawns[filename].conns.filter(c => {
                        try {
                            c.send(chunk)
                            return true
                        } catch (e) {}
                    })
                    spawns[filename].stdout += chunk
                    if (spawns[filename].stdout.length > 1000000) spawns[filename].stdout = spawns[filename].stdout.slice(500000)
                }
                spawns[filename].process.stdout.on('data', on_data)
                spawns[filename].process.stderr.on('data', on_data)
            }
        } catch (e) {
            console.log('bad message: ' + msg + ' :: ' + e.stack)
        }
        res.writeHead(200, {
            'Content-Type' : 'text/plain',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*'
        })
        res.end('ok')
    })

    var wss = new (require('ws').Server)({server})
    wss.on('connection', function connection(ws, req) {
        var filename = req.url.slice(1)

        console.log(`-- websocket filename: ${filename}`)

        if (!spawns[filename]) spawns[filename] = {stdout: '', conns: []}

        ws.send(spawns[filename].stdout)

        spawns[filename].conns.push(ws)
    })

    server.listen(port)
    console.log(`listening on port ${port}..`)
}
