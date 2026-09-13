import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const guidePath=process.argv[2] || new URL('../SKYSECURE_AI_AGENT_ENGINEERING_AND_PRODUCTION_GUIDE.html',import.meta.url);
const html=await readFile(guidePath,'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const refresh=scripts.at(-1)[1];
const currentHash='a'.repeat(64),newHash='b'.repeat(64);
function fixture({protocol='https:',loadedVersion=currentHash,version=newHash,offline=false,hidden=false}={}) {
    let interval, replacement, calls=0, requestOptions;
    const storage=new Map();
    const events={};
    const context={
        URL,AbortController,Date,JSON,
        document:{hidden,querySelector:()=>({content:loadedVersion}),addEventListener:(name,fn)=>{events[name]=fn;}},
        window:{
            location:{protocol,href:'https://skysecure-agent-factory.github.io/.github/?section=step-0#step-23',replace:url=>{replacement=url;}},
            setInterval:fn=>{interval=fn;},setTimeout:()=>1,clearTimeout:()=>{}
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
    return {run:()=>interval?.(),events,get calls(){return calls;},get replacement(){return replacement;},get options(){return requestOptions;},get active(){return !!interval;}};
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
test('hidden tabs defer checks and repeated deployment version is throttled',async()=>{
    const hidden=fixture({hidden:true});await hidden.run();assert.equal(hidden.calls,0);
    const f=fixture();await f.run();const first=f.replacement;await f.run();assert.equal(f.replacement,first);
});
