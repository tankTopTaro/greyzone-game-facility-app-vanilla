import net from 'net'
import os from 'os'
import dns from 'dns/promises'
import { exec } from 'child_process'

export async function tcpPing(host, port, timeout = 1500) {
   // console.log(`TCP ping to ${host}:${port}...`)
   let resolvedHost

   try {
      const result = await dns.lookup(host, { family: 4 })
      resolvedHost = result.address
      // console.log(`Resolved ${host} via DNS to ${resolvedHost}`)
   } catch (err) {
      if (host.endsWith('.local')) {
         // console.warn(`DNS lookup failed for ${host}. Trying fallback method...`)
         // Fallback using ping (basic .local resolution via system)
         resolvedHost = await resolveLocalHostViaPing(host)
         if (!resolvedHost) {
            // console.error(`Could not resolve ${host} via fallback`)
            throw new Error(`Failed to resolve .local hostname: ${host}`)
         }
         // console.log(`Resolved ${host} via fallback to ${resolvedHost}`)
      } else {
         // console.error(`DNS lookup for ${host} failed: ${err.message}`)
         throw err
      }
   }

   // Proceed with TCP ping using resolvedHost
   return new Promise((resolve, reject) => {
      const socket = new net.Socket()

      const onError = (err) => {
         // console.warn(`TCP error to ${resolvedHost}:${port} - ${err.message}`)
         socket.destroy()
         reject(err)
      }

      socket.setTimeout(timeout)
      socket.once('error', onError)
      socket.once('timeout', () => onError(new Error('Timeout')))
      socket.connect(port, resolvedHost, () => {
         // console.log(`TCP connection to ${resolvedHost}:${port} successful`)
         socket.end()
         resolve(true)
      })
   })
}

async function resolveLocalHostViaPing(host) {
   const isWin = os.platform() === 'win32'
   const pingCommand = isWin ? `ping -n 1 ${host}` : `ping -c 1 ${host}`

   return new Promise((resolve) => {
      exec(pingCommand, (err, stdout) => {
         if (err || !stdout) return resolve(null)

         const match = stdout.match(/(?:Reply from|bytes from) ([\d.]+)/)
         if (match && match[1]) {
            resolve(match[1])
         } else {
            resolve(null)
         }
      })
   })
}