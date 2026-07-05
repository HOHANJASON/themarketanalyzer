const http = require("http");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "public");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const base = "https://api.binance.com/api/v3";
let scanCache = { at: 0, data: null };
let specialCache = { at: 0, data: null };
const specialMarkets = [
  ["EURUSD=X","EUR/USD","外匯"],["GBPUSD=X","GBP/USD","外匯"],["USDJPY=X","USD/JPY","外匯"],
  ["AUDUSD=X","AUD/USD","外匯"],["USDCAD=X","USD/CAD","外匯"],["USDCHF=X","USD/CHF","外匯"],
  ["GC=F","黃金","商品"],["SI=F","白銀","商品"],["CL=F","原油","商品"],["DX-Y.NYB","美元指數","指數"]
];

function reply(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
async function market(req, res, url) {
  const symbol = (url.searchParams.get("symbol") || "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const interval = url.searchParams.get("interval") || "15m";
  if (!new Set(["1m","5m","15m","30m","1h","4h","1d"]).has(interval)) return reply(res, 400, { error: "Unsupported interval" });
  try {
    const [k,t] = await Promise.all([fetch(`${base}/klines?symbol=${symbol}&interval=${interval}&limit=240`),fetch(`${base}/ticker/24hr?symbol=${symbol}`)]);
    if (!k.ok || !t.ok) throw new Error(`Binance response ${k.status}/${t.status}`);
    reply(res, 200, { symbol, interval, klines: await k.json(), ticker: await t.json() });
  } catch (error) { reply(res, 502, { error: error.message }); }
}
function metrics(rows) {
  const close=rows.map(x=>+x[4]), high=rows.map(x=>+x[2]), low=rows.map(x=>+x[3]), vol=rows.map(x=>+x[7]);
  const last=close.at(-1), prev=close.at(-2);
  const avg=(a,n,end=a.length)=>a.slice(end-n,end).reduce((s,x)=>s+x,0)/n;
  const ema=(a,n)=>{let v=a[0],k=2/(n+1);return a.map((x,i)=>v=i?x*k+v*(1-k):x)};
  const fast=ema(close,12),slow=ema(close,26);
  const macd=(fast.at(-1)-slow.at(-1))/last*100, macdPrev=(fast.at(-2)-slow.at(-2))/prev*100;
  const hasVolume=vol.some(x=>x>0);
  const activity=hasVolume?vol:close.map((x,i)=>i?Math.abs(x/close[i-1]-1)*10000:0);
  const volRatio=activity.at(-1)/Math.max(avg(activity,20,activity.length-1),.000001);
  const breakout=(last/Math.max(...high.slice(-21,-1))-1)*100;
  const breakdown=(Math.min(...low.slice(-21,-1))/last-1)*100;
  const impulse=(last/close.at(-4)-1)*100, trend=(last/avg(close,20)-1)*100;
  let gain=0,loss=0;for(let i=close.length-14;i<close.length;i++){const d=close[i]-close[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0)}
  const rsi=100-100/(1+gain/Math.max(loss,.0000001));
  const trueRanges=close.map((x,i)=>i?Math.max(high[i]-low[i],Math.abs(high[i]-close[i-1]),Math.abs(low[i]-close[i-1])):high[i]-low[i]);
  const atrPct=avg(trueRanges,14)/last*100;
  const rangeHigh=Math.max(...high.slice(-20)),rangeLow=Math.min(...low.slice(-20));
  const rangePosition=(last-rangeLow)/Math.max(rangeHigh-rangeLow,.0000001);
  const returns=close.slice(-30).map((x,i,a)=>i?Math.log(x/a[i-1]):0).slice(1);
  const mean=avg(returns,returns.length),sigma=Math.sqrt(avg(returns.map(x=>(x-mean)**2),returns.length));
  const upScore=Math.max(0,Math.min(100,Math.round(42+Math.min(volRatio,4)*10+
    Math.max(-8,Math.min(18,impulse*5))+Math.max(-7,Math.min(13,breakout*7))+
    Math.max(-5,Math.min(10,trend*3))+Math.max(-4,Math.min(8,(macd-macdPrev)*25)))));
  const downScore=Math.max(0,Math.min(100,Math.round(42+Math.min(volRatio,4)*10+
    Math.max(-8,Math.min(18,-impulse*5))+Math.max(-7,Math.min(13,breakdown*7))+
    Math.max(-5,Math.min(10,-trend*3))+Math.max(-4,Math.min(8,-(macd-macdPrev)*25)))));
  const direction=upScore>=downScore?"up":"down",score=Math.max(upScore,downScore);
  return {score,upScore,downScore,direction,price:last,change:(last/prev-1)*100,volRatio,breakout,breakdown,impulse,
    rsi,atrPct,rangePosition,sigma};
}
function enrichCandidate(candidate) {
  const f=candidate.frames["15m"], f30=candidate.frames["30m"];
  const projectedDaily=Math.max(f.sigma*Math.sqrt(96)*100*1.65,f30.sigma*Math.sqrt(48)*100*1.65);
  let setup,setupDirection,early=false;
  if(f.rsi>=72&&f.rangePosition>.82){setup="暴漲後回撤";setupDirection="down"}
  else if(f.rsi<=28&&f.rangePosition<.18){setup="暴跌後反彈";setupDirection="up"}
  else if(f.rangePosition>.72&&f.breakout<=0&&f.volRatio>=.85){setup="上漲前蓄勢";setupDirection="up";early=true}
  else if(f.rangePosition<.28&&f.breakdown<=0&&f.volRatio>=.85){setup="下跌前轉弱";setupDirection="down";early=true}
  else {setup=candidate.direction==="up"?"多頭加速":"空頭加速";setupDirection=candidate.direction}
  const potential5=projectedDaily>=5;
  const leverageForDouble=projectedDaily>0?100/projectedDaily:null;
  const price=f.price,atr=price*f.atrPct/100,sign=setupDirection==="up"?1:-1;
  const entryLow=setupDirection==="up"?price-atr*.35:price-atr*.10;
  const entryHigh=setupDirection==="up"?price+atr*.10:price+atr*.35;
  const tp1=price+sign*atr*1.6,tp2=price+sign*atr*2.7,sl=price-sign*atr*1.15;
  const holding=early?"6–24 小時":setup.includes("後")?"2–12 小時":"1–6 小時";
  const extremePenalty=Math.max(0,projectedDaily-25)*.5;
  const confidence=Math.max(20,Math.min(95,Math.round(candidate.score*.55+candidate.aligned*9+
    Math.min(f.volRatio,2)*5+(setup.includes("後")?4:0)-extremePenalty)));
  const invalidation=setupDirection==="up"?`15 分鐘收盤跌破 ${sl}`:`15 分鐘收盤站上 ${sl}`;
  return {...candidate,setup,setupDirection,early,projectedDaily,potential5,leverageForDouble,confidence,
    plan:{entryLow,entryHigh,tp1,tp2,sl,holding,riskReward1:Math.abs((tp1-price)/(price-sl)),invalidation}};
}
async function scanMarket(req,res) {
  if (scanCache.data && Date.now()-scanCache.at<45000) return reply(res,200,scanCache.data);
  try {
    const response=await fetch(`${base}/ticker/24hr`);
    if(!response.ok) throw new Error(`Binance response ${response.status}`);
    const tickers=await response.json(), excluded=/(UP|DOWN|BULL|BEAR)USDT$/;
    const liquid=tickers.filter(t=>t.symbol.endsWith("USDT")&&!excluded.test(t.symbol)&&+t.quoteVolume>5000000)
      .sort((a,b)=>+b.quoteVolume-+a.quoteVolume).slice(0,40);
    const intervals=["5m","15m","30m"];
    const candidates=await Promise.all(liquid.map(async ticker=>{
      const frames={};
      await Promise.all(intervals.map(async interval=>{
        const r=await fetch(`${base}/klines?symbol=${ticker.symbol}&interval=${interval}&limit=80`);
        if(!r.ok) throw new Error(`${ticker.symbol} ${r.status}`);
        frames[interval]=metrics(await r.json());
      }));
      const up=Math.round(frames["5m"].upScore*.45+frames["15m"].upScore*.35+frames["30m"].upScore*.2);
      const down=Math.round(frames["5m"].downScore*.45+frames["15m"].downScore*.35+frames["30m"].downScore*.2);
      const direction=up>=down?"up":"down",raw=Math.max(up,down);
      const aligned=intervals.filter(i=>frames[i].direction===direction&&frames[i].score>=70).length;
      return enrichCandidate({symbol:ticker.symbol,label:ticker.symbol.replace("USDT",""),market:"加密貨幣",source:"Binance",direction,
        score:Math.min(100,raw+aligned*2),aligned,quoteVolume:+ticker.quoteVolume,frames});
    }));
    let mexcCandidates=[],mexcUniverse=0;
    try {
      const mr=await fetch("https://api.mexc.com/api/v3/ticker/24hr");
      if(mr.ok){
        const mt=await mr.json();mexcUniverse=mt.filter(t=>t.symbol.endsWith("USDT")).length;
        let volatile=mt.filter(t=>t.symbol.endsWith("USDT")&&+t.quoteVolume>=100000&&Number.isFinite(+t.priceChangePercent))
          .sort((a,b)=>Math.abs(+b.priceChangePercent)-Math.abs(+a.priceChangePercent)).slice(0,15);
        const pinned=mt.find(t=>t.symbol==="BUSDT");
        if(pinned&&!volatile.some(t=>t.symbol==="BUSDT"))volatile.push(pinned);
        const settled=await Promise.allSettled(volatile.map(async ticker=>{
          const frames={};await Promise.all(intervals.map(async interval=>{
            const r=await fetch(`https://api.mexc.com/api/v3/klines?symbol=${ticker.symbol}&interval=${interval}&limit=80`);
            if(!r.ok)throw new Error(`MEXC ${ticker.symbol} ${r.status}`);frames[interval]=metrics(await r.json());
          }));
          const up=Math.round(frames["5m"].upScore*.45+frames["15m"].upScore*.35+frames["30m"].upScore*.2);
          const down=Math.round(frames["5m"].downScore*.45+frames["15m"].downScore*.35+frames["30m"].downScore*.2);
          const direction=up>=down?"up":"down",raw=Math.max(up,down);
          const aligned=intervals.filter(i=>frames[i].direction===direction&&frames[i].score>=70).length;
          return enrichCandidate({symbol:ticker.symbol,label:ticker.symbol.slice(0,-4),market:"高波動貨幣",source:"MEXC",
            change24h:+ticker.priceChangePercent*100,direction,score:Math.min(100,raw+aligned*2),aligned,quoteVolume:+ticker.quoteVolume,frames});
        }));
        mexcCandidates=settled.filter(x=>x.status==="fulfilled").map(x=>x.value);
      }
    } catch {}
    const combined=[...candidates,...mexcCandidates].sort((a,b)=>b.score-a.score);
    const data={updatedAt:Date.now(),universe:tickers.filter(t=>t.symbol.endsWith("USDT")).length+mexcUniverse,
      highVolatilityCount:mexcCandidates.length,candidates:combined.slice(0,35)};
    scanCache={at:Date.now(),data}; reply(res,200,data);
  } catch(error) { reply(res,502,{error:error.message}); }
}
async function yahooFrame(symbol,interval) {
  const u=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=5d`;
  const r=await fetch(u,{headers:{"user-agent":"Mozilla/5.0"}});
  if(!r.ok) throw new Error(`Yahoo ${symbol} ${r.status}`);
  const result=(await r.json()).chart.result?.[0], q=result?.indicators?.quote?.[0];
  if(!result||!q) throw new Error(`No data ${symbol}`);
  const rows=result.timestamp.map((t,i)=>[t*1000,q.open[i],q.high[i],q.low[i],q.close[i],q.volume[i]||0,t*1000,q.volume[i]||0])
    .filter(x=>[x[1],x[2],x[3],x[4]].every(Number.isFinite)).slice(-80);
  return metrics(rows);
}
async function scanSpecial(req,res) {
  if(specialCache.data&&Date.now()-specialCache.at<45000)return reply(res,200,specialCache.data);
  const intervals=["5m","15m","30m"];
  const settled=await Promise.allSettled(specialMarkets.map(async([symbol,label,market])=>{
    const frames={};await Promise.all(intervals.map(async i=>frames[i]=await yahooFrame(symbol,i)));
    const up=Math.round(frames["5m"].upScore*.45+frames["15m"].upScore*.35+frames["30m"].upScore*.2);
    const down=Math.round(frames["5m"].downScore*.45+frames["15m"].downScore*.35+frames["30m"].downScore*.2);
    const direction=up>=down?"up":"down",raw=Math.max(up,down);
    const aligned=intervals.filter(i=>frames[i].direction===direction&&frames[i].score>=70).length;
    return enrichCandidate({symbol,label,market,source:"Yahoo",direction,score:Math.min(100,raw+aligned*2),aligned,frames});
  }));
  const candidates=settled.filter(x=>x.status==="fulfilled").map(x=>x.value).sort((a,b)=>b.score-a.score);
  const data={updatedAt:Date.now(),universe:specialMarkets.length,candidates};
  specialCache={at:Date.now(),data};reply(res,200,data);
}
async function analyzeWatched(req,res,url){
  const symbol=(url.searchParams.get("symbol")||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
  const source=url.searchParams.get("source")==="MEXC"?"MEXC":"Binance";
  if(!symbol)return reply(res,400,{error:"Missing symbol"});
  try{
    const api=source==="MEXC"?"https://api.mexc.com/api/v3":base,frames={},intervals=["5m","15m","30m"];
    await Promise.all(intervals.map(async interval=>{
      const r=await fetch(`${api}/klines?symbol=${symbol}&interval=${interval}&limit=80`);
      if(!r.ok)throw new Error(`${source} ${symbol} ${r.status}`);frames[interval]=metrics(await r.json());
    }));
    const up=Math.round(frames["5m"].upScore*.45+frames["15m"].upScore*.35+frames["30m"].upScore*.2);
    const down=Math.round(frames["5m"].downScore*.45+frames["15m"].downScore*.35+frames["30m"].downScore*.2);
    const direction=up>=down?"up":"down",raw=Math.max(up,down);
    const aligned=intervals.filter(i=>frames[i].direction===direction&&frames[i].score>=70).length;
    reply(res,200,enrichCandidate({symbol,label:symbol.slice(0,-4),market:source==="MEXC"?"高波動貨幣":"加密貨幣",
      source,direction,score:Math.min(100,raw+aligned*2),aligned,frames}));
  }catch(error){reply(res,502,{error:error.message})}
}
http.createServer(async(req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if(url.pathname==="/api/market") return market(req,res,url);
  if(url.pathname==="/api/scan") return scanMarket(req,res);
  if(url.pathname==="/api/special") return scanSpecial(req,res);
  if(url.pathname==="/api/analyze") return analyzeWatched(req,res,url);
  const target=path.join(root,url.pathname==="/"?"index.html":url.pathname);
  if(!target.startsWith(root)) return reply(res,403,{error:"Forbidden"});
  fs.readFile(target,(error,data)=>{
    if(error) return reply(res,404,{error:"Not found"});
    res.writeHead(200,{"content-type":`${mime[path.extname(target)]||"application/octet-stream"}; charset=utf-8`});res.end(data);
  });
}).listen(process.env.PORT||4173,()=>console.log(`Market analyzer running at http://localhost:${process.env.PORT||4173}`));
