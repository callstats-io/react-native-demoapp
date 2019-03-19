'use strict';

import React, { Component } from 'react';
import createReactClass from 'create-react-class';
import {
  AppRegistry,
  StyleSheet,
  Text,
  View,
  TextInput,
  ListView,
  WebView,
  Button,
  Image,
  TouchableHighlight,
  Dimensions,
} from 'react-native';

require('react-native-callstats/csio-polyfill');
console.log('loaded polyfill');
import io from 'socket.io-client/dist/socket.io';
console.log('loaded io', io);
import callstats from 'react-native-callstats/callstats';
console.log('loaded callstats', callstats);

var socket1 = io.connect('https://demo.callstats.io', {transports: ['websocket']});

var  dimensions = Dimensions.get('window');

var createTokenGeneratorTimer;
createTokenGeneratorTimer = function (forcenew, callback) {
   return setTimeout(function () { console.log("calling tokenGenerator"); tokenGenerator(forcenew, callback);}, 100);
};

var tokenGenerator = function(forcenew, callback) {
  socket1.emit('generateToken', localUserID, function (err, token) {
    if (err) {
      console.log('Token generation failed');
      console.log("try again");
      return createTokenGeneratorTimer(forcenew, callback);
    }
    console.log("received token ",token);
    callback(null, token);
  });
};

var appID = "";
var appSecret = "";
var localUserID;
var conferenceID;
var seed = 1;
var getWifiStats = function() {
  var wifistats = {
    quality: 80,
    signal: 20,
  }
  return new Promise(function(resolve, reject) {
    seed++;
    wifistats.signal = wifistats.signal + seed;
    resolve(JSON.stringify(wifistats));
  });
}

console.log("creating callstats ");
var callStats = new callstats();
if (callStats.attachWifiStatsHandler) {
  callStats.attachWifiStatsHandler(getWifiStats);
}
var fabricUsage = callStats.fabricUsage.multiplex;

import {
  RTCPeerConnection,
  RTCMediaStream,
  RTCIceCandidate,
  RTCSessionDescription,
  RTCView,
  MediaStreamTrack,
  getUserMedia,
  mediaDevices,
} from 'react-native-webrtc';


var turnServer = {
  url: 'turn:turn-server-1.dialogue.io:3478',
  username: 'test',
  credential: '1234',
  realm: 'reTurn'
};
var turnServerTls = {
  url: 'turn:turn-server-1.dialogue.io:5349',
  username: 'test',
  credential: '1234',
  realm: 'reTurn'
};
var iceServers = [turnServer, turnServerTls];
var configuration = {'iceTransports': 'all','iceServers': iceServers};

var pcPeers = {};
var localStream;

function getLocalStream(isFront, callback) {
  mediaDevices.enumerateDevices().then(sourceInfos => {
    let videoSourceId;
    for (let i = 0; i < sourceInfos.length; i++) {
      const sourceInfo = sourceInfos[i];
      if(sourceInfo.kind == "video" && sourceInfo.facing == (isFront ? "front" : "back")) {
        videoSourceId = sourceInfo.id;
      }
    }
    mediaDevices.getUserMedia({
      audio: true,
      video: {
        mandatory: {
          minWidth: 500, // Provide your own width, height and frame rate here
          minHeight: 300,
          minFrameRate: 30
        },
        facingMode: (isFront ? "user" : "environment"),
        optional: (videoSourceId ? [{sourceId: videoSourceId}] : [])
      }
    })
    .then(stream => {
      callback(stream);
    })
    .catch(error => {
      // Log error
    });
  });
}

function join(roomID) {
  console.log("joining ",roomID);
  socket1.emit('join', roomID);
  conferenceID = roomID;
}

/**
 * Receive details from another user
 */
function handleUserMessage(userId, message) {
  var pc;
  if (pcPeers[userId]) {
    pc = pcPeers[userId];
  } else {
    pc = createPC(userId, false);
  }
  var json = JSON.parse(message);
  if (json.ice) {
    pc.addIceCandidate(new RTCIceCandidate(json.ice));
  }
  if (json.offer) {
    pc.setRemoteDescription(new RTCSessionDescription(json.offer))
    .then(() => {
      if (pc.remoteDescription.type == "offer") {
        pc.createAnswer()
        .then(desc => {
          pc.setLocalDescription(desc)
          .then(() => {
            var json = {'offer': pc.localDescription};
            var str = JSON.stringify(json);
            socket1.emit('message', userId, str);
          })
          .catch(error => {
            console.log('setLocalDescription error ', error);
          });
        })
        .catch(error => {
          console.log('createAnswer error ', error);
        });
      }
    })
    .catch(error => {
      console.log('setRemoteDescription error ', error);
    });
  }
}


function createPC(socketId, isOffer) {
  var error = {
    message: "creating pc for "+socketId,
    error: "Info",
    stack: "Info Info Info"
  };
  console.log("creating pc for ",socketId);
  var pc = new RTCPeerConnection(configuration);
  callStats.addNewFabric(pc, socketId ,fabricUsage, conferenceID);
  pcPeers[socketId] = pc;
  callStats.reportError(pc, conferenceID,callStats.webRTCFunctions.applicationError,"Report error");
  callStats.reportError(pc, conferenceID,callStats.webRTCFunctions.applicationError,error);
  pc.onicecandidate = function (event) {
    //console.log('onicecandidate');
    if (event.candidate) {
      //socket.emit('exchange', {'to': socketId, 'candidate': event.candidate });
      var json = {'ice': event.candidate};
      var str = JSON.stringify(json);
      socket1.emit('message', socketId, str);
    }
  };

  function createOffer() {
    pc.createOffer()
    .then(desc => {
      pc.setLocalDescription(desc)
      .then(() => {
        var json = {'offer': pc.localDescription};
        var str = JSON.stringify(json);
        socket1.emit('message', socketId, str);
      })
      .catch(error => {
        console.log('setLocalDescription error', error);
      });
    })
    .catch(error => {
      console.log('createOffer error', error);
    });
  }

  pc.onnegotiationneeded = function () {
    console.log('onnegotiationneeded', isOffer);
    if (isOffer) {
      createOffer();
    }
  };

  pc.oniceconnectionstatechange = function(event) {
    console.log('oniceconnectionstatechange', event.target.iceConnectionState);
  };

  pc.onsignalingstatechange = function(event) {
    console.log('onsignalingstatechange', event.target.signalingState);
  };

  pc.onaddstream = function (event) {
    container.setState({info: 'One participant joined!'});

    var remoteList = container.state.remoteList;
    remoteList[socketId] = event.stream.toURL();
    container.setState({ remoteList: remoteList });
    getStats();
  };

  pc.onremovestream = function (event) {
    console.log('onremovestream');
  };

  if (localStream) {
    pc.addStream(localStream);
  }
  return pc;
}

function leave(socketId) {
  console.log('leave', socketId);
  var pc = pcPeers[socketId];
  var viewIndex = pc.viewIndex;
  pc.close();
  delete pcPeers[socketId];

  var remoteList = container.state.remoteList;
  delete remoteList[socketId];
  container.setState({ remoteList: remoteList });
  container.setState({info: 'One participant left!'});
}

function cscallback(msg, status) {
  console.log('cscallback ',msg, status);
}
socket1.on('connect', function(data){
  console.log("Connect 123",socket1.id);
  localUserID = socket1.id;
  console.log("init ", appID, appSecret);
  callStats.initialize(appID, appSecret, localUserID, cscallback);
});

socket1.on('join', function(userID){
  console.log("join ",userID);
  createPC(userID, true);
});

socket1.on('leave', function(userID){
  console.log("leave",userID);
  leave(userID);
});

socket1.on('message', function(userID, message){
  handleUserMessage(userID, message);
});

function logError(error) {
  console.log("logError", error);
}

function mapHash(hash, func) {
  var array = [];
  for (var key in hash) {
    var obj = hash[key];
    array.push(func(obj, key));
  }
  return array;
}

function getStats() {
  console.log('calling getstats');
  var pc = pcPeers[Object.keys(pcPeers)[0]];
  pc.getStats()
  .then(stats => {
    console.log('stats from getStats ', stats);
  });
}

var container;

var RCTWebRTCDemo = createReactClass({
  getInitialState: function() {
    this.ds = new ListView.DataSource({rowHasChanged: (r1, r2) => true});
    return {
      info: 'Initializing',
      status: 'init',
      roomID: 'room',
      isFront: true,
      selfViewSrc: null,
      remoteList: {},
      joinState: true,
    };
  },
  componentDidMount: function() {
    container = this;
  },
  getLocalCameraStream() {
    getLocalStream(true, function(stream) {
      localStream = stream;
      for (const id in pcPeers) {
        const pc = pcPeers[id];
        pc.addStream(localStream);
      }
      container.setState({selfViewSrc: stream.toURL()});
      container.setState({status: 'ready', info: 'I am in room - '+container.state.roomID});
    });
  },
  _switchVideoType() {
    const isFront = !this.state.isFront;
    this.setState({isFront});
    getLocalStream(isFront, function(stream) {
      if (localStream) {
        for (const id in pcPeers) {
          const pc = pcPeers[id];
          pc && pc.removeStream(localStream);
        }
        localStream.release();
      }
      localStream = stream;
      container.setState({selfViewSrc: stream.toURL()});

      for (const id in pcPeers) {
        const pc = pcPeers[id];
        pc && pc.addStream(localStream);
      }
    });
  },
  handleJoinClick() {
    this.setState({joinState: false});
    this.getLocalCameraStream();
    //this.refs.roomID.blur();
    this.setState({status: 'connect', info: 'Connecting'});
    join(this.state.roomID);
  },
  renderMainContainer() {
    if (!this.state.joinState) {
      return (
        <View style={styles.container}>
        <View style={{flexDirection: 'row', backgroundColor: '#282849'}}>
          <Image
            style={{width: 29, height: 30, margin:10}}
            source={{uri: 'https://dashboard.callstats.io/static/minimal-logo.png'}}
          />
        </View>
          <Text style={styles.welcome}>
            {this.state.info}
          </Text>
          <View style={{flexDirection: 'row', justifyContent: 'center', margin: 10}}>
            <RTCView streamURL={this.state.selfViewSrc} style={styles.selfView}/>
          </View>
          <View style={{flexDirection: 'row', justifyContent: 'center', margin: 10}}>
            {
              mapHash(this.state.remoteList, function(remote, index) {
                return <RTCView key={index} streamURL={remote} style={styles.remoteView}/>
              })
            }
          </View>
        </View>
      );
    }
    return null;
  },
  renderJoinContainer() {
    if (this.state.joinState) {
      return (
        <View style={styles.joinContainer}>
          <Image
            style={{width: 87, height: 90, margin:10}}
            source={{uri: 'https://dashboard.callstats.io/static/minimal-logo.png'}}
          />
          <Text style={styles.welcome}>
            Enter the Room Name to Join/Create
          </Text>
          <TextInput style={styles.joinName}
            placeholder={"Room Name"} placeholderTextColor={"#000"}
            onChangeText={(text) => this.setState({roomID: text})}
          />
          <TouchableHighlight style={styles.joinButton}
              onPress={this.handleJoinClick}>
            <Text style={styles.joinButtonText}>{"Join/Create"}</Text>
          </TouchableHighlight>
        </View>
      );
    }
    return null;
  },
  render() {
    return (
      <View style={styles.container}>
      {this.renderJoinContainer()}
      {this.renderMainContainer()}
      </View>
    );
  }
});

const styles = StyleSheet.create({
  selfView: {
    width: 200,
    height: 150,
    margin: 10,
  },
  remoteView: {
    width: 200,
    height: 150,
    margin: 10,
  },
  container: {
    flex: 1,
    backgroundColor: "rgba(124, 193, 223, 0.5)",
  },
  welcome: {
    fontSize: 20,
    textAlign: 'center',
    margin: 10,
  },
  joinContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: dimensions.width,
    height: dimensions.height,
    backgroundColor: "rgba(124, 193, 223, 0.5)",
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    //borderWidth: 1, borderColor: "white"
  },
  listViewContainer: {
    height: 150,
  },
  joinName: {
    height: 50,
    width: 300,
    marginLeft: 20,
    marginRight: 20,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#000",
    textAlign: "center",
    color: "black"
  },
  joinButton: {
    marginTop: 10,
    borderRadius: 5,
    backgroundColor: "#337ab7",
    padding: 10
  },
  joinButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold"
  }
});




AppRegistry.registerComponent('RCTWebRTCDemo', () => RCTWebRTCDemo);
