export class IdGenerator {
    constructor(serverId) {
        if (serverId < 0 || serverId > 1023) {
            throw new Error('Server ID must be between 0 and 1023');
        }
        this.serverId = serverId;
        this.sequence = 0n;
        this.lastTimestamp = -1n;
    }

    generate() {
        let timestamp = BigInt(Date.now());

        if (timestamp < this.lastTimestamp) {
            // Handle clock moving backwards
            timestamp = this.lastTimestamp;
        }

        if (timestamp === this.lastTimestamp) {
            this.sequence = (this.sequence + 1n) & 4095n; // 12 bits max
            if (this.sequence === 0n) {
                // Sequence exhausted, wait for next millisecond
                timestamp = this.#waitNextMillis(this.lastTimestamp);
            }
        } else {
            this.sequence = 0n;
        }

        this.lastTimestamp = timestamp;

        // Structure: 41 bits timestamp | 10 bits server id | 12 bits sequence
        const id = (timestamp << 22n) | 
                  (BigInt(this.serverId) << 12n) | 
                  this.sequence;

        // Return as string to avoid any BigInt conversion issues
        return id.toString();
    }

    #waitNextMillis(lastTimestamp) {
        let timestamp = BigInt(Date.now());
        while (timestamp <= lastTimestamp) {
            timestamp = BigInt(Date.now());
        }
        return timestamp;
    }
}
