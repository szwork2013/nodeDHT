var crypto = require("crypto");
var dgram = require("dgram");

var bencode = require("bencode");

var BOOTSTRAP_NODES = [
    ["router.bittorrent.com", 6881],
    ["dht.transmissionbt.com", 6881],
    ["router.utorrent.com", 6881]
];
var TID_LENGTH = 4;
var MAX_QNODE_SIZE = 1000;

function randomID() {
    return new Buffer(
        crypto.createHash("sha1")
            .update(crypto.randomBytes(20))
            .digest("hex"),
        "hex"
    );
}

function decodeNodes(data) {
  var nodes = [];
  for (var i = 0; i + 26 <= data.length; i += 26) {
    nodes.push({
      nid: data.slice(i, i + 20),
      address: data[i + 20] + "." + data[i + 21] + "." +
               data[i + 22] + "." + data[i + 23],
      port: data.readUInt16BE(i + 24)
    });
  }
  return nodes;
};

function getNeighbor(target) {
    return  Buffer.concat([target.slice(0, 10), randomID().slice(10)]);
}

function entropy(len) {
    var text = [];
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZab" 
        + "cdefghijklmnopqrstuvwxyz0123456789";
    var length = chars.length;
    for (var i=0; i < len; i++) {
        text.push(chars.charAt(Math.floor(Math.random() * length)));
    }
    return text.join("");
}

function DHT(master, bindIP, bindPort) {
    this.master = master;
    this.bindIP = bindIP;
    this.bindPort = bindPort;
    this.ktable = new KTable();
    this.udp = dgram.createSocket("udp4");    
    this.udp.bind(this.bindPort, this.bindIP);
}
DHT.prototype.sendKRPC = function(msg, rinfo) {
    try {
        var buf = bencode.encode(msg);
        this.udp.send(buf, 0, buf.length, rinfo.port, rinfo.address);
    } catch (ex) {
        //do nothing
    }
};
DHT.prototype.processFindNodeReceived = function(nodes) {
    var nodes = decodeNodes(nodes);
    var self = this;
    nodes.forEach(function(node) {
        if (node.address == self.bindIP && node.port == self.bindPort
            || node.nid == self.ktable.nid) {
        } else {
            self.ktable.push(new KNode(node.address, node.port, node.nid));
        }
    });
};
DHT.prototype.processGetPeers = function(msg, rinfo) {
    var infohash = msg.a.info_hash;
    if (infohash) {
        this.master.log(infohash.toString("hex"));
    }
    var msg = {
        t: entropy(TID_LENGTH), 
        y: "e", 
        e: [203, "Server Error"]
    };
    this.sendKRPC(msg, rinfo);
};
DHT.prototype.sendFindNode = function(rinfo, nid) {
    if (nid === undefined) {
        var nid = randomID();
    } else {
        var nid = getNeighbor(nid);
    }
    var msg = {
        t: entropy(TID_LENGTH),
        y: "q",
        q: "find_node",
        a: {
            id: nid,
            target: randomID()
        }
    };
    this.sendKRPC(msg, rinfo);
};
DHT.prototype.joinDHT = function() {
    var self = this;
    BOOTSTRAP_NODES.forEach(function(node) {
        self.sendFindNode({address: node[0], port: node[1]});
    });
};
DHT.prototype.dataReceived = function(msg, rinfo) {
    try {
        var msg = bencode.decode(msg);
        if (msg.y == "r" && msg.r.nodes) {
            this.processFindNodeReceived(msg.r.nodes);
        }
        else if(msg.y == "q" && (msg.q == "get_peers")) {
            this.processGetPeers(msg, rinfo);
        }
        else if(msg.y == "q" && (msg.q == "find_node")) {
            //this.processFindNode(msg, rinfo);
        }
    } catch (ex) {
        //do nothing
    }
};
DHT.prototype.wander = function() {
    var self = this;
    this.ktable.nodes.forEach(function(node) {
        self.sendFindNode({address: node.address, port: node.port}, node.nid);
    });
    this.ktable.nodes = [];
};
DHT.prototype.start = function() {
    var self = this;
    this.udp.on("message", function(msg, rinfo) {
        self.dataReceived(msg, rinfo);
    });
    this.udp.on("error", function(err) {
        //do nothing
    });
    var self = this;

    (function timer1() {
        self.joinDHT();
        setTimeout(timer1, 10000);
    })();

    (function timer2() {
        self.wander();
        setTimeout(timer2, 1000);
    })();
};

function Master() {}
Master.prototype.log = function(infohash) {
    console.log(infohash);
};

function KTable() {
    this.nid = randomID();
    this.nodes = [];
}
KTable.prototype.push = function(node) {
    if (this.nodes.length >= MAX_QNODE_SIZE) {
        return
    }
    this.nodes.push(node);
};

function KNode(address, port, nid) {
    this.address = address;
    this.port = port;
    this.nid = nid;
}

new DHT(new Master(), "0.0.0.0", 2881).start();