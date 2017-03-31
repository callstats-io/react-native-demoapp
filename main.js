'use strict';

import React, { Component } from 'react';
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
} from 'react-native';


import io from 'socket.io-client/dist/socket.io';
import callstats from 'react-native-callstats/callstats';

var socket1 = io.connect('https://demo.callstats.io', {transports: ['websocket']});

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
    console.log("received token",token);
    callback(null, token);
  });
};

var appID = "175240362";
var appSecret = "Gvd126EUWQheaWQX9mwmeWIbzvs=";
var localUserID;
var conferenceID;

var callStats = new callstats();
var fabricUsage = callStats.fabricUsage.multiplex;

import {
  RTCPeerConnection,
  RTCMediaStream,
  RTCIceCandidate,
  RTCSessionDescription,
  RTCView,
  MediaStreamTrack,
  getUserMedia,
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
  MediaStreamTrack.getSources(sourceInfos => {
    var videoSourceId;
    for (var i = 0; i < sourceInfos.length; i++) {
      var sourceInfo = sourceInfos[i];
      if(sourceInfo.kind == "video" && sourceInfo.facing == (isFront ? "front" : "back")) {
        videoSourceId = sourceInfo.id;
      }
    }
    getUserMedia({
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
    }, function (stream) {
      callback(stream);
    }, logError);
  });
}

function join(roomID) {
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
    pc.setRemoteDescription(new RTCSessionDescription(json.offer), function () {
      if (pc.remoteDescription.type == "offer")
        pc.createAnswer(function(desc) {
          pc.setLocalDescription(desc, function () {
            var json = {'offer': pc.localDescription};
            var str = JSON.stringify(json);
            socket1.emit('message', userId, str);
          }, logError);
        }, logError);
    }, logError);
  }
}


function createPC(socketId, isOffer) {
  console.log("creating pc for ",socketId);
  var pc = new RTCPeerConnection(configuration);
  callStats.addNewFabric(pc, socketId ,fabricUsage, conferenceID);
  pcPeers[socketId] = pc;

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
    pc.createOffer(function(desc) {
      //console.log('createOffer', desc);
      pc.setLocalDescription(desc, function () {
        //console.log('setLocalDescription', pc.localDescription);
        //socket.emit('exchange', {'to': socketId, 'sdp': pc.localDescription });
        var json = {'offer': pc.localDescription};
        var str = JSON.stringify(json);
        socket1.emit('message', socketId, str);
      }, logError);
    }, logError);
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
    container.setState({info: 'One peer join!'});

    var remoteList = container.state.remoteList;
    remoteList[socketId] = event.stream.toURL();
    container.setState({ remoteList: remoteList });
  };

  pc.onremovestream = function (event) {
    console.log('onremovestream');
  };

  pc.addStream(localStream);
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
  container.setState({info: 'One peer leave!'});
}

socket1.on('connect', function(data){
  console.log("Connect ",socket1.id);
  localUserID = socket1.id;

  getLocalStream(true, function(stream) {
    localStream = stream;
    container.setState({selfViewSrc: stream.toURL()});
    container.setState({status: 'ready', info: 'Please enter or create room ID'});
  });

  callStats.initialize(appID, tokenGenerator, localUserID);
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
  var pc = pcPeers[Object.keys(pcPeers)[0]];
  pc.getStats(null, function(report) {
    function onFabricStats(stats) {
      console.log('getStats report', stats);
    }
  });
}

var container;

var RCTWebRTCDemo = React.createClass({
  getInitialState: function() {
    this.ds = new ListView.DataSource({rowHasChanged: (r1, r2) => true});
    return {
      info: 'Initializing',
      status: 'init',
      roomID: '',
      isFront: true,
      selfViewSrc: null,
      remoteList: {},
    };
  },
  componentDidMount: function() {
    container = this;
  },
  _press(event) {
    this.refs.roomID.blur();
    this.setState({status: 'connect', info: 'Connecting'});
    join(this.state.roomID);
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
  render() {
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
        { this.state.status == 'ready' ?
          (<View style={{flexDirection: 'row', justifyContent: 'center', margin: 10}}>
            <TextInput
              ref='roomID'
              autoCorrect={false}
              style={{width: 200, height: 40, borderColor: 'gray', borderWidth: 1, marginRight: 10}}
              onChangeText={(text) => this.setState({roomID: text})}
              value={this.state.roomID}
            />
            <Button
              onPress={this._press}
              title="Create/Join"
              />
          </View>) : null
        }
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
    backgroundColor: '#F5FCFF',
  },
  welcome: {
    fontSize: 20,
    textAlign: 'center',
    margin: 10,
  },
  listViewContainer: {
    height: 150,
  },
});

AppRegistry.registerComponent('RCTWebRTCDemo', () => RCTWebRTCDemo);
