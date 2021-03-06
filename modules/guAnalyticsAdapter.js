// see http://prebid.org/dev-docs/integrate-with-the-prebid-analytics-api.html
import adapter from 'src/AnalyticsAdapter';
import CONSTANTS from 'src/constants.json';
import * as adaptermanager from 'src/adaptermanager';
import * as utils from 'src/utils';
import {ajax} from 'src/ajax';

const analyticsType = 'endpoint';
const QUEUE_TIMEOUT = 4000;

let analyticsAdapter = Object.assign(adapter({analyticsType}),
  {
    track({eventType, args}) {
      if (!analyticsAdapter.context) {
        return;
      }
      let handler = null;
      switch (eventType) {
        case CONSTANTS.EVENTS.AUCTION_INIT:
          if (analyticsAdapter.context.queue) {
            analyticsAdapter.context.queue.init();
          }
          handler = trackAuctionInit;
          break;
        case CONSTANTS.EVENTS.BID_REQUESTED:
          handler = trackBidRequest;
          break;
        case CONSTANTS.EVENTS.BID_RESPONSE:
          handler = trackBidResponse;
          break;
        case CONSTANTS.EVENTS.BID_TIMEOUT:
          handler = trackBidTimeout;
          break;
        case CONSTANTS.EVENTS.AUCTION_END:
          handler = trackAuctionEnd;
          break;
      }
      if (handler) {
        let events = handler(args);
        if (analyticsAdapter.context.queue) {
          analyticsAdapter.context.queue.push(events);
        }
        if (eventType === CONSTANTS.EVENTS.AUCTION_END) {
          sendAll();
        }
      }
    }
  });

function buildRequestTemplate(options) {
  return {
    pv: options.pv
  }
}

function sendAll() {
  let events = analyticsAdapter.context.queue.popAll();
  if (events.length !== 0) {
    let req = Object.assign({}, analyticsAdapter.context.requestTemplate, {hb_ev: events});
    ajax(
      `${analyticsAdapter.context.ajaxUrl}/commercial/api/hb`,
      () => {
      },
      JSON.stringify(req),
      {
        method: 'PUT',
        contentType: 'application/json; charset=utf-8'
      }
    );
  }
}

function trackAuctionInit(args) {
  analyticsAdapter.context.auctionTimeStart = Date.now();
  const event = createHbEvent(undefined, 'init', undefined, args.auctionId);
  return [event];
}

function trackBidRequest(args) {
  return args.bids.map(bid =>
    createHbEvent(args.bidderCode, 'request', bid.adUnitCode));
}

function trackBidResponse(args) {
  const event = createHbEvent(args.bidderCode, 'response', args.adUnitCode, undefined, args.timeToRespond);
  return [event];
}

function trackBidTimeout(args) {
  const timeToRespond = Date.now() - analyticsAdapter.context.auctionTimeStart;
  return args.map(bid => createHbEvent(bid.bidder, 'timeout', bid.adUnitCode, undefined, timeToRespond));
}

function trackAuctionEnd(args) {
  const duration = Date.now() - analyticsAdapter.context.auctionTimeStart;
  const event = createHbEvent(undefined, 'end', undefined, args.auctionId, duration);
  return [event];
}

function createHbEvent(bidder, event, slotId, auctionId, timeToRespond, args) {
  let ev = {ev: event};
  if (bidder) {
    ev.n = bidder
  }
  if (slotId) {
    ev.sid = slotId;
  }
  if (auctionId) {
    ev.aid = auctionId;
  }
  if (timeToRespond) {
    ev.ttr = timeToRespond;
  }
  if (args) {
    ev.args = args;
  }
  return ev;
}

export function ExpiringQueue(callback, ttl) {
  let queue = [];
  let timeoutId;

  this.push = (event) => {
    if (event instanceof Array) {
      queue.push.apply(queue, event);
    } else {
      queue.push(event);
    }
    reset();
  };

  this.popAll = () => {
    let result = queue;
    queue = [];
    reset();
    return result;
  };

  /**
   * For test/debug purposes only
   * @return {Array}
   */
  this.peekAll = () => {
    return queue;
  };

  this.init = reset;

  function reset() {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      if (queue.length) {
        callback();
      }
    }, ttl);
  }
}

analyticsAdapter.context = {};

analyticsAdapter.originEnableAnalytics = analyticsAdapter.enableAnalytics;

analyticsAdapter.enableAnalytics = (config) => {
  if (!config.options.ajaxUrl) {
    utils.logError('ajaxUrl is not defined. Analytics won\'t work');
    return;
  }
  if (!config.options.pv) {
    utils.logError('pv is not defined. Analytics won\'t work');
    return;
  }
  analyticsAdapter.context = {
    ajaxUrl: config.options.ajaxUrl,
    pv: config.options.pv,
    requestTemplate: buildRequestTemplate(config.options),
    queue: new ExpiringQueue(sendAll, QUEUE_TIMEOUT)
  };
  analyticsAdapter.originEnableAnalytics(config);
};

adaptermanager.registerAnalyticsAdapter({
  adapter: analyticsAdapter,
  code: 'gu'
});

export default analyticsAdapter;
