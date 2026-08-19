const net = require('net');

class PrinterManager {
  /**
   * Check if a printer is online by attempting to connect to its IP and Port
   * @param {string} ip 
   * @param {number|string} port 
   * @param {number} timeoutMs 
   * @returns {Promise<string>} 'online' | 'offline'
   */
  checkStatus(ip, port, timeoutMs = 2000) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let isOnline = false;

      socket.setTimeout(timeoutMs);

      socket.connect(Number(port), ip, () => {
        isOnline = true;
        socket.end();
      });

      socket.on('error', (err) => {
        console.warn(`[PrinterManager] Connection check failed for ${ip}:${port} - ${err.message}`);
        resolve('offline');
      });

      socket.on('timeout', () => {
        console.warn(`[PrinterManager] Connection check timed out for ${ip}:${port}`);
        socket.destroy();
        resolve('offline');
      });

      socket.on('close', () => {
        resolve(isOnline ? 'online' : 'offline');
      });
    });
  }

  /**
   * Sends raw binary ESC/POS data to the printer with built-in retry logic
   * @param {string} ip 
   * @param {number|string} port 
   * @param {Buffer|Uint8Array} data 
   * @param {number} retries 
   * @param {number} delayMs 
   * @returns {Promise<void>}
   */
  async print(ip, port, data, retries = 3, delayMs = 1500) {
    let attempt = 0;
    while (attempt < retries) {
      try {
        await this._sendToSocket(ip, Number(port), data);
        console.log(`[PrinterManager] Print job successfully sent to ${ip}:${port}`);
        return;
      } catch (err) {
        attempt++;
        console.error(`[PrinterManager] Attempt ${attempt}/${retries} failed to print to ${ip}:${port}: ${err.message}`);
        if (attempt >= retries) {
          throw new Error(`Failed to connect to printer at ${ip}:${port} after ${retries} attempts. error: ${err.message}`);
        }
        // Wait before next retry
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Raw TCP connection and socket write
   * @private
   */
  _sendToSocket(ip, port, data) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      
      socket.setTimeout(5000); // 5s write timeout

      socket.connect(port, ip, () => {
        socket.write(Buffer.from(data), () => {
          socket.end();
          resolve();
        });
      });

      socket.on('error', (err) => {
        reject(err);
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Connection timeout during print operation'));
      });
    });
  }
}

module.exports = new PrinterManager();
