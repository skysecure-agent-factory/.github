import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const guidePath=process.argv[2] || new URL('../SKYSECURE_AI_AGENT_ENGINEERING_AND_PRODUCTION_GUIDE.html',import.meta.url);
const html=await readFile(guidePath,'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const refresh=scripts.at(-1)[1];
const currentHash='a'.repeat(64),newHash='b'.repeat(64);
const checkIntervalMs=5*60*1000;
function fixture({protocol='https:',loadedVersion=currentHash,version=newHash,offline=false,hidden=false,storage=new Map(),initialTime=0}={}) {
    let interval, intervalMs, replacement, replacements=0, calls=0, requestOptions, now=initialTime;
    const events={};
    const context={
        URL,AbortController,Date:{now:()=>now},JSON,
        document:{hidden,querySelector:()=>({content:loadedVersion}),addEventListener:(name,fn)=>{events[name]=fn;}},
        window:{
            location:{protocol,href:'https://skysecure-agent-factory.github.io/.github/?section=step-0#step-23',replace:url=>{replacement=url;replacements++;}},
            setInterval:(fn,ms)=>{interval=fn;intervalMs=ms;},setTimeout:()=>1,clearTimeout:()=>{}
        },
        sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
        fetch:async(url,options)=>{
            calls++; requestOptions=options;
            assert.equal(url.href,'https://skysecure-agent-factory.github.io/.github/guide-version.json');
            if (offline) throw new Error('Offline');
            return {ok:true,json:async()=>({sourceHash:version})};
        }
    };
    vm.runInNewContext(refresh,context);
    return {
        run:()=>interval?.(),
        visibility:()=>events.visibilitychange?.(),
        advance:ms=>{now+=ms;},
        setHidden:value=>{context.document.hidden=value;},
        get calls(){return calls;},get replacement(){return replacement;},get replacements(){return replacements;},
        get options(){return requestOptions;},get active(){return !!interval;},get intervalMs(){return intervalMs;}
    };
}
test('new live version refreshes same guide URL while preserving section',async()=>{
    const f=fixture(); await f.run();
    const url=new URL(f.replacement);
    assert.equal(url.origin,'https://skysecure-agent-factory.github.io');
    assert.equal(url.pathname,'/.github/');
    assert.equal(url.searchParams.get('section'),'step-0');
    assert.equal(url.searchParams.get('guideVersion'),newHash);
    assert.equal(url.hash,'#step-23');
    assert.equal(f.options.credentials,'omit');
    assert.equal(f.options.cache,'no-store');
});
test('unchanged version does not reload',async()=>{const f=fixture({version:currentHash});await f.run();assert.equal(f.replacement,undefined);});
test('offline and malformed responses keep guide usable',async()=>{
    for (const options of [{offline:true},{version:'invalid'}]) {const f=fixture(options);await f.run();assert.equal(f.replacement,undefined);}
});
test('local source never polls network',async()=>{
    for (const options of [{protocol:'file:'},{loadedVersion:'local'}]) {const f=fixture(options);assert.equal(f.active,false);await f.run();assert.equal(f.calls,0);}
});
test('foreground checks are scheduled every five minutes with no startup request',async()=>{
    const f=fixture({version:currentHash});
    assert.equal(f.calls,0);
    assert.equal(f.intervalMs,checkIntervalMs);
    f.advance(checkIntervalMs);await f.run();assert.equal(f.calls,1);
    f.advance(checkIntervalMs-1);await f.run();assert.equal(f.calls,1);
    f.advance(1);await f.run();assert.equal(f.calls,2);
});
test('visibility return and timer share one five-minute request budget',async()=>{
    const f=fixture({version:currentHash});
    await f.visibility();assert.equal(f.calls,1);
    for(let i=0;i<10;i++) {
        f.setHidden(true);await f.visibility();
        f.setHidden(false);await f.visibility();
        await f.run();
    }
    assert.equal(f.calls,1);
    f.advance(checkIntervalMs-1);await f.visibility();assert.equal(f.calls,1);
    f.advance(1);await f.visibility();assert.equal(f.calls,2);
    await f.run();assert.equal(f.calls,2);
});
test('hidden tabs make no requests and do not consume the foreground budget',async()=>{
    const f=fixture({hidden:true,version:currentHash});
    f.advance(checkIntervalMs);await f.run();await f.visibility();assert.equal(f.calls,0);
    f.setHidden(false);await f.visibility();assert.equal(f.calls,1);
    f.setHidden(true);f.advance(checkIntervalMs);await f.run();assert.equal(f.calls,1);
    f.setHidden(false);await f.visibility();assert.equal(f.calls,2);
});
test('failed requests also wait five minutes before another attempt',async()=>{
    const f=fixture({offline:true});
    await f.visibility();assert.equal(f.calls,1);
    await f.visibility();await f.run();assert.equal(f.calls,1);
    f.advance(checkIntervalMs);await f.run();assert.equal(f.calls,2);
    assert.equal(f.replacements,0);
});
test('session reload guard prevents a loop while a new deployment propagates',async()=>{
    const storage=new Map();
    const first=fixture({storage,initialTime:checkIntervalMs});await first.visibility();
    assert.equal(first.replacements,1);
    const reloaded=fixture({storage,initialTime:checkIntervalMs+1});await reloaded.visibility();
    assert.equal(reloaded.calls,1);
    assert.equal(reloaded.replacements,0);
    reloaded.advance(checkIntervalMs);await reloaded.run();
    assert.equal(reloaded.replacements,1);
});
