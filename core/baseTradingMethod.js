var _ = require('lodash');
var util = require('../core/util.js');
var config = util.getConfig();
var dirs = util.dirs();
var log = require('../core/log.js');

if(config.tradingAdvisor.talib.enabled) {
  // verify talib is installed properly
  var pluginHelper = require(dirs.core + 'pluginUtil');
  var pluginMock = {
    slug: 'tradingAdvisor',
    dependencies: [{
      module: 'talib',
      version: config.tradingAdvisor.talib.version
    }]
  };

  var cannotLoad = pluginHelper.cannotLoad(pluginMock);
  if(cannotLoad)
    util.die(cannotLoad);

  var talib = require(dirs.core + 'talib');
}

var indicatorsPath = '../methods/indicators/';

var Indicators = {
  MACD: {
    factory: require(indicatorsPath + 'MACD'),
    input: 'price'
  },
  EMA: {
    factory: require(indicatorsPath + 'EMA'),
    input: 'price'
  },
  DEMA: {
    factory: require(indicatorsPath + 'DEMA'),
    input: 'price'
  },
  PPO: {
    factory: require(indicatorsPath + 'PPO'),
    input: 'price'
  },
  LRC: {
    factory: require(indicatorsPath + 'LRC'),
    input: 'price'
  },
  SMA: {
    factory: require(indicatorsPath + 'SMA'),
    input: 'price'
  },

  RSI: {
    factory: require(indicatorsPath + 'RSI'),
    input: 'candle'
  },
  CCI: {
    factory: require(indicatorsPath + 'CCI'),
    input: 'candle'
  }
};

var allowedIndicators = _.keys(Indicators);
var allowedTalibIndicators = _.keys(talib);

var Base = function() {
  _.bindAll(this);

  // properties
  this.age = 0;
  this.processedTicks = 0;
  this.setup = false;

  // defaults
  this.requiredHistory = 0;
  this.priceValue = 'close';
  this.indicators = {};
  this.talibIndicators = {};
  this.asyncTick = false;

  this.candleProps = {
    open: [],
    high: [],
    low: [],
    close: [],
    volume: []
  };

  // make sure we have all methods
  _.each(['init', 'check'], function(fn) {
    if(!this[fn])
      util.die('No ' + fn + ' function in this trading method found.')
  }, this);

  if(!this.update)
    this.update = function() {};

  // let's run the implemented starting point
  this.init();

  // should be set up now, check some things
  // to make sure everything is implemented
  // correctly.
  if(!this.name)
    log.warn('Warning, trading method has no name');

  if(!config.debug || !this.log)
    this.log = function() {};

  this.setup = true;

  if(_.size(this.talibIndicators))
    this.asyncTick = true;
}

// teach our base trading method events
var Util = require('util');
var EventEmitter = require('events').EventEmitter;
Util.inherits(Base, EventEmitter);

Base.prototype.tick = function(candle) {
  this.age++;
  this.candle = candle;

  if(this.asyncTick) {
    this.candleProps.open.push(candle.open);
    this.candleProps.high.push(candle.high);
    this.candleProps.low.push(candle.low);
    this.candleProps.close.push(candle.close);
    this.candleProps.volume.push(candle.volume);

    if(this.age > 1000) {
      this.candleProps.open.shift();
      this.candleProps.high.shift();
      this.candleProps.low.shift();
      this.candleProps.close.shift();
      this.candleProps.volume.shift();
    }
  }

  // update all indicators
  var price = candle[this.priceValue];
  _.each(this.indicators, function(i) {
    if(i.input === 'price')
      i.update(price);
    if(i.input === 'candle')
      i.update(candle);
  });

  // update the trading method
  if(!this.asyncTick || this.requiredHistory > this.age) {
    this.propogateTick();
  } else {
    var next = _.after(
      _.size(this.talibIndicators),
      this.propogateTick
    );

    _.each(
      this.talibIndicators,
      i => i._fn(next),
      this
    );
  }

  // update previous price
  this.lastPrice = price;
}

Base.prototype.propogateTick = function() {
  this.update(this.candle);
  if(this.requiredHistory <= this.age) {
    this.log();
    this.check();
  }
  this.processedTicks++;

  // are we totally finished
  if(this.finishCb && this.age === this.processedTicks)
    this.finishCb();
}

Base.prototype.addTalibIndicator = function(name, type, parameters) {
  if(!talib)
    util.die('Talib is not enabled');

  if(!_.contains(allowedTalibIndicators, type))
    util.die('I do not know the talib indicator ' + type);

  if(this.setup)
    util.die('Can only add talib indicators in the init method!');

  var basectx = this;

  // TODO: cleanup..
  this.talibIndicators[name] = {
    _params: parameters,
    _fn: function(done) {
      var args = _.clone(parameters);
      args.unshift(basectx.candleProps);

      talib[type].apply(this, args)(function(err, result) {
        if(err)
          util.die('TALIB ERROR:', err);

        this.result = _.mapValues(result, function(a) { return _.last(a); });
        done();
      }.bind(this));
    },
    result: NaN
  }
}

Base.prototype.addIndicator = function(name, type, parameters) {
  if(!_.contains(allowedIndicators, type))
    util.die('I do not know the indicator ' + type);

  if(this.setup)
    util.die('Can only add indicators in the init method!');

  this.indicators[name] = new Indicators[type].factory(parameters);

  // some indicators need a price stream, others need full candles
  this.indicators[name].input = Indicators[type].input;
}

Base.prototype.advice = function(newPosition) {
  // Possible values are long and short. Long will trigger a buy method
  // while short will trigger a sell method
  var advice = 'soft';
  if(newPosition) {
    advice = newPosition;
  }

  this.emit('advice', {
    recommandation: advice,
    portfolio: 1,
    moment: this.candle.start
  });
}

// Because the trading method might be async we need
// to be sure we only stop after all candles are
// processed.
Base.prototype.finish = function(done) {
  if(!this.asyncTick)
    return done();

  if(this.age === this.processedTicks)
    return done();

  // we are not done, register cb
  // and call after we are..
  this.finishCb = done;
}

module.exports = Base;
