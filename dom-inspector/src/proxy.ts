import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";

let server: http.Server | undefined;
let currentTarget: string = "";
let proxyPort = 0;

const INSPECTOR_SCRIPT = `
<script data-kiro-inspector>
(function(){
// ---------------------------------------------------------------------------
// OverlayRenderer
// ---------------------------------------------------------------------------
var COLORS = {
  content: 'rgba(111, 168, 220, 0.66)',
  padding: 'rgba(147, 196, 125, 0.55)',
  border: 'rgba(255, 229, 153, 0.66)',
  margin: 'rgba(246, 178, 107, 0.66)'
};
var OVERLAY_Z = '2147483646';
var BASE_STYLES = {position:'fixed',pointerEvents:'none',zIndex:OVERLAY_Z,display:'none',boxSizing:'border-box'};
var TOOLTIP_STYLES = {position:'fixed',pointerEvents:'none',zIndex:'2147483647',display:'none',background:'#0d1117',color:'#e6edf3',font:'11px/1.4 monospace',padding:'2px 6px',borderRadius:'3px',border:'1px solid #30363d',maxWidth:'400px',overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'};

function parsePx(v){ return parseFloat(v)||0; }

function buildTooltipLabel(tag, classNames, id, w, h){
  var label = tag.toLowerCase();
  if(classNames.length>0) label += '.' + classNames.join('.');
  if(id) label += '#' + id;
  label += ' (' + Math.round(w) + ' \\u00d7 ' + Math.round(h) + ')';
  return label;
}

function computeBoxModelRects(contentRect, padding, border, margin){
  var pr = {x:contentRect.x-padding.left, y:contentRect.y-padding.top, width:contentRect.width+padding.left+padding.right, height:contentRect.height+padding.top+padding.bottom};
  var br = {x:pr.x-border.left, y:pr.y-border.top, width:pr.width+border.left+border.right, height:pr.height+border.top+border.bottom};
  var mr = {x:br.x-margin.left, y:br.y-margin.top, width:br.width+margin.left+margin.right, height:br.height+margin.top+margin.bottom};
  return {content:contentRect, padding:pr, border:br, margin:mr};
}

var OverlayRenderer = (function(){
  function OR(){ this.contentDiv=null; this.paddingDiv=null; this.borderDiv=null; this.marginDiv=null; this.tooltipDiv=null; this.initialized=false; }
  OR.prototype.init = function(){
    if(this.initialized) return;
    this.marginDiv = mkDiv(COLORS.margin);
    this.borderDiv = mkDiv(COLORS.border);
    this.paddingDiv = mkDiv(COLORS.padding);
    this.contentDiv = mkDiv(COLORS.content);
    this.tooltipDiv = mkTooltip();
    var root = document.documentElement;
    root.appendChild(this.marginDiv); root.appendChild(this.borderDiv);
    root.appendChild(this.paddingDiv); root.appendChild(this.contentDiv);
    root.appendChild(this.tooltipDiv);
    this.initialized = true;
  };
  OR.prototype.draw = function(el){
    this._ensureInit();
    var rect = el.getBoundingClientRect();
    var cs; try{ cs = getComputedStyle(el); }catch(e){
      this._positionOverlays({x:rect.x,y:rect.y,width:rect.width,height:rect.height},{top:0,right:0,bottom:0,left:0},{top:0,right:0,bottom:0,left:0},{top:0,right:0,bottom:0,left:0});
      this._updateTooltip(el, rect); return;
    }
    var pad = {top:parsePx(cs.paddingTop),right:parsePx(cs.paddingRight),bottom:parsePx(cs.paddingBottom),left:parsePx(cs.paddingLeft)};
    var bdr = {top:parsePx(cs.borderTopWidth),right:parsePx(cs.borderRightWidth),bottom:parsePx(cs.borderBottomWidth),left:parsePx(cs.borderLeftWidth)};
    var mar = {top:parsePx(cs.marginTop),right:parsePx(cs.marginRight),bottom:parsePx(cs.marginBottom),left:parsePx(cs.marginLeft)};
    var cr = {x:rect.x+bdr.left+pad.left, y:rect.y+bdr.top+pad.top, width:rect.width-bdr.left-bdr.right-pad.left-pad.right, height:rect.height-bdr.top-bdr.bottom-pad.top-pad.bottom};
    this._positionOverlays(cr, pad, bdr, mar);
    this._updateTooltip(el, rect);
  };
  OR.prototype.drawHighlight = function(selector){ var el=document.querySelector(selector); if(el) this.draw(el); };
  OR.prototype.clear = function(){
    var divs=[this.contentDiv,this.paddingDiv,this.borderDiv,this.marginDiv,this.tooltipDiv];
    for(var i=0;i<divs.length;i++) if(divs[i]) divs[i].style.display='none';
  };
  OR.prototype.destroy = function(){
    var divs=[this.contentDiv,this.paddingDiv,this.borderDiv,this.marginDiv,this.tooltipDiv];
    for(var i=0;i<divs.length;i++) if(divs[i]&&divs[i].parentNode) divs[i].parentNode.removeChild(divs[i]);
    this.contentDiv=this.paddingDiv=this.borderDiv=this.marginDiv=this.tooltipDiv=null;
    this.initialized=false;
  };
  OR.prototype._ensureInit = function(){ if(!this.initialized||!this.contentDiv||!this.contentDiv.parentNode){ this.initialized=false; this.init(); } };
  OR.prototype._positionOverlays = function(cr,pad,bdr,mar){
    var rects = computeBoxModelRects(cr,pad,bdr,mar);
    applyRect(this.contentDiv, rects.content); applyRect(this.paddingDiv, rects.padding);
    applyRect(this.borderDiv, rects.border); applyRect(this.marginDiv, rects.margin);
  };
  OR.prototype._updateTooltip = function(el, rect){
    if(!this.tooltipDiv) return;
    var tag=el.tagName.toLowerCase(), id=el.id||null;
    var cn=(el.className&&typeof el.className==='string')?el.className.trim().split(/\\s+/).filter(Boolean):[];
    this.tooltipDiv.textContent = buildTooltipLabel(tag,cn,id,rect.width,rect.height);
    var ty = rect.top>24 ? rect.top-22 : rect.bottom+4;
    this.tooltipDiv.style.top=ty+'px'; this.tooltipDiv.style.left=rect.left+'px'; this.tooltipDiv.style.display='block';
  };
  function mkDiv(color){ var d=document.createElement('div'); d.dataset.kiroOverlay='true'; Object.assign(d.style,BASE_STYLES,{background:color}); return d; }
  function mkTooltip(){ var d=document.createElement('div'); d.dataset.kiroOverlay='true'; Object.assign(d.style,TOOLTIP_STYLES); return d; }
  function applyRect(div,r){ div.style.top=r.y+'px'; div.style.left=r.x+'px'; div.style.width=Math.max(0,r.width)+'px'; div.style.height=Math.max(0,r.height)+'px'; div.style.display='block'; }
  return OR;
})();

// ---------------------------------------------------------------------------
// DOMExtractor
// ---------------------------------------------------------------------------
function getClassNames(el){ if(el.className&&typeof el.className==='string') return el.className.trim().split(/\\s+/).filter(Boolean); return []; }
function getAttributes(el){ var a={}; for(var i=0;i<el.attributes.length;i++){ var at=el.attributes[i]; a[at.name]=at.value; } return a; }

function generateSelector(el){
  var tag=el.tagName.toLowerCase();
  if(el.id) return tag+'#'+el.id;
  var cls=getClassNames(el);
  if(cls.length>0){ var cs=tag+'.'+cls.join('.'); try{ if(document.querySelectorAll(cs).length===1) return cs; }catch(e){} }
  var par=el.parentElement; if(!par) return tag;
  var sibs=par.children, idx=0, cnt=0;
  for(var i=0;i<sibs.length;i++){ if(sibs[i].tagName===el.tagName){ cnt++; if(sibs[i]===el) idx=cnt; } }
  return cnt===1?tag:tag+':nth-of-type('+idx+')';
}

function buildSelectorPath(el){
  var parts=[]; var cur=el;
  while(cur&&cur!==document.documentElement){ parts.unshift(generateSelector(cur)); cur=cur.parentElement; }
  return parts.join(' > ');
}

function extractBoxModel(el){
  var rect=el.getBoundingClientRect();
  var cs; try{ cs=getComputedStyle(el); }catch(e){
    return {content:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},padding:{top:0,right:0,bottom:0,left:0},border:{top:0,right:0,bottom:0,left:0},margin:{top:0,right:0,bottom:0,left:0}};
  }
  var pad={top:parsePx(cs.paddingTop),right:parsePx(cs.paddingRight),bottom:parsePx(cs.paddingBottom),left:parsePx(cs.paddingLeft)};
  var bdr={top:parsePx(cs.borderTopWidth),right:parsePx(cs.borderRightWidth),bottom:parsePx(cs.borderBottomWidth),left:parsePx(cs.borderLeftWidth)};
  var mar={top:parsePx(cs.marginTop),right:parsePx(cs.marginRight),bottom:parsePx(cs.marginBottom),left:parsePx(cs.marginLeft)};
  var cr={x:rect.x+bdr.left+pad.left,y:rect.y+bdr.top+pad.top,width:rect.width-bdr.left-bdr.right-pad.left-pad.right,height:rect.height-bdr.top-bdr.bottom-pad.top-pad.bottom};
  return {content:cr,padding:pad,border:bdr,margin:mar};
}

function extractComputedStyles(el){
  try{ var cs=getComputedStyle(el); return {display:cs.display,position:cs.position,color:cs.color,backgroundColor:cs.backgroundColor,fontSize:cs.fontSize,fontFamily:cs.fontFamily,width:cs.width,height:cs.height,boxSizing:cs.boxSizing}; }
  catch(e){ return {display:'',position:'',color:'',backgroundColor:'',fontSize:'',fontFamily:'',width:'',height:'',boxSizing:''}; }
}

var DOMExtractor = (function(){
  function DE(){}
  DE.prototype.getHoverData = function(el){
    var rect=el.getBoundingClientRect();
    return {tag:el.tagName.toLowerCase(),id:el.id||null,classNames:getClassNames(el),width:rect.width,height:rect.height,boxModel:extractBoxModel(el)};
  };
  DE.prototype.getFullData = function(el){
    var tag=el.tagName.toLowerCase(), id=el.id||null, cn=getClassNames(el), attrs=getAttributes(el);
    var text=(el.textContent||'').slice(0,200), outerSnippet=el.outerHTML.slice(0,500);
    var selector=generateSelector(el), domPath=this.getDOMPath(el), children=this._getDirectChildren(el);
    var boxModel=extractBoxModel(el), computedStyles=extractComputedStyles(el);
    return {selector:selector,tag:tag,id:id,classNames:cn,attrs:attrs,text:text,outerSnippet:outerSnippet,domPath:domPath,children:children,boxModel:boxModel,computedStyles:computedStyles,componentInfo:null};
  };
  DE.prototype.getChildren = function(selector){ var el=document.querySelector(selector); return el?this._getDirectChildren(el):[]; };
  DE.prototype.getDOMPath = function(el){
    var path=[]; var cur=el;
    while(cur){ var tag=cur.tagName.toLowerCase(); var seg=tag; if(cur.id) seg+='#'+cur.id; var cls=getClassNames(cur); if(cls.length>0) seg+='.'+cls.join('.'); path.unshift(seg); cur=cur.parentElement; }
    return path;
  };
  DE.prototype._getDirectChildren = function(el){
    var children=[];
    for(var i=0;i<el.children.length;i++){ var ch=el.children[i]; children.push({tag:ch.tagName.toLowerCase(),id:ch.id||null,classNames:getClassNames(ch),childCount:ch.children.length,selectorPath:buildSelectorPath(ch)}); }
    return children;
  };
  return DE;
})();

// ---------------------------------------------------------------------------
// FrameworkDetector
// ---------------------------------------------------------------------------
function safeGet(fn){ try{ return fn(); }catch(e){ return undefined; } }
function findKeyWithPrefix(obj, prefix){ return Object.keys(obj).find(function(k){ return k.indexOf(prefix)===0; }); }

var FrameworkDetector = (function(){
  function FD(){}
  FD.prototype.detect = function(){
    try{
      if(window.__REACT_DEVTOOLS_GLOBAL_HOOK__) return 'react';
      if(window.__VUE_DEVTOOLS_GLOBAL_HOOK__) return 'vue';
      if(window.ng) return 'angular';
      if(window.__svelte_meta) return 'svelte';
    }catch(e){ console.warn('[kiro-inspector] Framework detection error:', e); }
    return null;
  };
  FD.prototype.getComponentInfo = function(el){
    var fw=this.detect(); if(!fw) return null;
    try{
      switch(fw){
        case 'react': return this._getReact(el);
        case 'vue': return this._getVue(el);
        case 'angular': return this._getAngular(el);
        case 'svelte': return this._getSvelte(el);
        default: return null;
      }
    }catch(e){ console.warn('[kiro-inspector] Error extracting '+fw+' component info:', e); return null; }
  };
  FD.prototype._getReact = function(el){
    var fk = findKeyWithPrefix(el,'__reactFiber$') || findKeyWithPrefix(el,'__reactInternalInstance$');
    if(!fk) return null; var fiber=el[fk]; if(!fiber) return null;
    var cur=fiber, compName=null, srcFile=null, srcLine=null;
    while(cur){ var t=cur.type;
      if(typeof t==='function'||typeof t==='object'){ var nm=safeGet(function(){ return typeof t==='function'?t.displayName||t.name:t&&(t.displayName||t.name); });
        if(nm){ compName=nm; var ds=safeGet(function(){ return cur._debugSource; }); if(ds){ srcFile=ds.fileName||null; srcLine=ds.lineNumber||null; } break; }
      } cur=cur.return;
    }
    if(!compName) return null;
    var path=[]; cur=fiber;
    while(cur){ var tp=cur.type; var n=safeGet(function(){ return typeof tp==='function'?tp.displayName||tp.name:typeof tp==='object'&&tp?(tp.displayName||tp.name):null; }); if(n) path.push(n); cur=cur.return; }
    return {framework:'react',componentName:compName,componentPath:path.reverse(),sourceFile:srcFile,sourceLine:srcLine};
  };
  FD.prototype._getVue = function(el){
    var v2=safeGet(function(){ return el.__vue__; });
    if(v2){ var nm=safeGet(function(){ return v2.$options&&v2.$options.name; })||safeGet(function(){ return v2.$options&&v2.$options._componentTag; })||'Anonymous';
      var sf=safeGet(function(){ return v2.$options&&v2.$options.__file; })||null;
      var cp=[]; var c=v2; while(c){ var n=safeGet(function(){ return c.$options&&c.$options.name; })||safeGet(function(){ return c.$options&&c.$options._componentTag; }); if(n) cp.push(n); c=safeGet(function(){ return c.$parent; }); }
      return {framework:'vue',componentName:nm,componentPath:cp.reverse(),sourceFile:sf,sourceLine:null};
    }
    var v3=safeGet(function(){ return el.__vueParentComponent; });
    if(v3){ var tp=safeGet(function(){ return v3.type; }); var nm3=safeGet(function(){ return tp&&tp.name; })||safeGet(function(){ return tp&&tp.__name; })||'Anonymous';
      var sf3=safeGet(function(){ return tp&&tp.__file; })||null;
      var cp3=[]; var c3=v3; while(c3){ var t3=safeGet(function(){ return c3.type; }); var n3=safeGet(function(){ return t3&&t3.name; })||safeGet(function(){ return t3&&t3.__name; }); if(n3) cp3.push(n3); c3=safeGet(function(){ return c3.parent; }); }
      return {framework:'vue',componentName:nm3,componentPath:cp3.reverse(),sourceFile:sf3,sourceLine:null};
    }
    return null;
  };
  FD.prototype._getAngular = function(el){
    var ng=safeGet(function(){ return window.ng; }); if(!ng||typeof ng.getComponent!=='function') return null;
    var comp=safeGet(function(){ return ng.getComponent(el); }); if(!comp) return null;
    var nm=safeGet(function(){ return comp.constructor&&comp.constructor.name; })||'Unknown';
    var cp=[]; var cur=el;
    while(cur){ var c=safeGet(function(){ return ng.getComponent(cur); }); if(c){ var n=safeGet(function(){ return c.constructor&&c.constructor.name; }); if(n) cp.push(n); } cur=cur.parentElement; }
    return {framework:'angular',componentName:nm,componentPath:cp.reverse(),sourceFile:null,sourceLine:null};
  };
  FD.prototype._getSvelte = function(el){
    var meta=safeGet(function(){ return el.__svelte_meta; }); if(!meta) return null;
    var loc=safeGet(function(){ return meta.loc; });
    var nm=safeGet(function(){ var f=loc&&loc.file; if(f){ var p=f.split('/'); return p[p.length-1].replace(/\\.svelte$/,''); } return null; })||'Unknown';
    var sf=safeGet(function(){ return loc&&loc.file; })||null;
    var sl=safeGet(function(){ var l=loc&&loc.line; return typeof l==='number'?l:null; })||null;
    var cp=[]; var cur=el;
    while(cur){ var m=safeGet(function(){ return cur.__svelte_meta; }); if(m){ var fl=safeGet(function(){ return m.loc&&m.loc.file; }); if(fl){ var pts=fl.split('/'); cp.push(pts[pts.length-1].replace(/\\.svelte$/,'')); } } cur=cur.parentElement; }
    return {framework:'svelte',componentName:nm,componentPath:cp.reverse(),sourceFile:sf,sourceLine:sl};
  };
  return FD;
})();

// ---------------------------------------------------------------------------
// InspectorScript
// ---------------------------------------------------------------------------
function postToParent(msg){ try{ window.parent.postMessage(msg,'*'); }catch(e){ console.warn('[kiro-inspector] Failed to post message:', e); } }
function isOverlayElement(el){ return el&&el instanceof HTMLElement&&el.dataset.kiroOverlay==='true'; }

var overlay = new OverlayRenderer();
var extractor = new DOMExtractor();
var detector = new FrameworkDetector();
var inspecting = false;
var rafPending = false;
var lastMouseEvent = null;

function startInspection(){
  if(inspecting) return;
  inspecting = true;
  overlay.init();
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onEscape, true);
}

function stopInspection(){
  if(!inspecting) return;
  inspecting = false; rafPending = false; lastMouseEvent = null;
  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onEscape, true);
  overlay.clear();
}

function onMouseMove(e){
  e.preventDefault(); e.stopPropagation();
  lastMouseEvent = e;
  if(!rafPending){ rafPending = true; requestAnimationFrame(function(){ rafPending = false; processMouseMove(); }); }
}

function processMouseMove(){
  var e = lastMouseEvent; if(!e||!inspecting) return;
  var el = document.elementFromPoint(e.clientX, e.clientY);
  if(!el||isOverlayElement(el)) return;
  overlay.draw(el);
  postToParent({type:'element_hovered', data:extractor.getHoverData(el)});
}

function onClick(e){
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  var el = document.elementFromPoint(e.clientX, e.clientY);
  if(!el||isOverlayElement(el)) return;
  var data = extractor.getFullData(el);
  data.componentInfo = detector.getComponentInfo(el);
  postToParent({type:'element_picked', data:data});
  stopInspection();
}

function onEscape(e){
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); postToParent({type:'element_pick_cancelled'}); stopInspection(); }
}

function handleMessage(e){
  var msg=e.data; if(!msg||typeof msg.type!=='string') return;
  switch(msg.type){
    case 'start_inspector': startInspection(); break;
    case 'stop_inspector': stopInspection(); break;
    case 'highlight_element': if(typeof msg.selector==='string'){ overlay.init(); overlay.drawHighlight(msg.selector); } break;
    case 'scroll_to_element': if(typeof msg.selector==='string'){ var el=document.querySelector(msg.selector); if(el) el.scrollIntoView({behavior:'smooth',block:'center',inline:'center'}); } break;
    case 'get_children': if(typeof msg.selector==='string'){ postToParent({type:'children_response',selector:msg.selector,children:extractor.getChildren(msg.selector)}); } break;
  }
}

function initInspector(){
  window.addEventListener('message', handleMessage);
  postToParent({type:'inspector_ready'});
  var fw = detector.detect();
  if(fw) postToParent({type:'framework_detected', framework:fw});
}

initInspector();
})();
</script>`;

export function startProxy(targetUrl: string): Promise<number> {
  currentTarget = targetUrl;

  if (server) {
    return Promise.resolve(proxyPort);
  }

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      let target: URL;
      try {
        target = new URL(req.url || "/", currentTarget);
      } catch {
        res.writeHead(400);
        res.end("Bad request: invalid URL");
        return;
      }

      const mod = target.protocol === "https:" ? https : http;

      // Ask upstream not to compress so we can reliably read HTML for injection
      const fwdHeaders = { ...req.headers, host: target.host, "accept-encoding": "identity" };

      const proxyReq = mod.request(target.href, {
        method: req.method,
        headers: fwdHeaders,
      }, (proxyRes) => {
        const statusCode = proxyRes.statusCode || 200;

        // Rewrite redirects so the browser stays on the proxy
        if (statusCode >= 300 && statusCode < 400 && proxyRes.headers.location) {
          try {
            const loc = new URL(proxyRes.headers.location, target.href);
            // Rewrite to a proxy-relative path so the iframe doesn't escape
            const rewritten = loc.pathname + loc.search + loc.hash;
            const redirHeaders: Record<string, string | string[] | undefined> = { ...proxyRes.headers, location: rewritten };
            delete redirHeaders["x-frame-options"];
            delete redirHeaders["content-security-policy"];
            delete redirHeaders["content-security-policy-report-only"];
            res.writeHead(statusCode, redirHeaders);
            res.end();
          } catch {
            // Malformed Location — forward as-is
            res.writeHead(statusCode, proxyRes.headers);
            res.end();
          }
          return;
        }

        const contentType = proxyRes.headers["content-type"] || "";
        const isHtml = contentType.includes("text/html");

        // Remove security headers that block framing
        const headers = { ...proxyRes.headers };
        delete headers["x-frame-options"];
        delete headers["content-security-policy"];
        delete headers["content-security-policy-report-only"];

        if (isHtml) {
          // Determine if we need to decompress
          const encoding = (proxyRes.headers["content-encoding"] || "").toLowerCase();
          delete headers["content-length"];
          delete headers["content-encoding"];
          delete headers["transfer-encoding"];
          res.writeHead(statusCode, headers);

          let decompressed: NodeJS.ReadableStream = proxyRes;
          if (encoding === "gzip" || encoding === "x-gzip") {
            decompressed = proxyRes.pipe(zlib.createGunzip());
          } else if (encoding === "br") {
            decompressed = proxyRes.pipe(zlib.createBrotliDecompress());
          } else if (encoding === "deflate") {
            decompressed = proxyRes.pipe(zlib.createInflate());
          }

          let body = "";
          decompressed.on("data", (c: Buffer | string) => body += c.toString());
          decompressed.on("end", () => {
            // Inject before </body> or at end
            const injected = body.replace(/<\/body>/i, INSPECTOR_SCRIPT + "</body>");
            res.end(injected === body ? body + INSPECTOR_SCRIPT : injected);
          });
          decompressed.on("error", () => {
            // Decompression failed — send whatever we have
            res.end(body || "");
          });
        } else {
          res.writeHead(statusCode, headers);
          proxyRes.pipe(res);
        }
      });

      proxyReq.on("error", (e) => {
        if (!res.headersSent) {
          res.writeHead(502);
        }
        res.end(`Proxy error: ${e.message}`);
      });

      req.pipe(proxyReq);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      proxyPort = typeof addr === "object" && addr ? addr.port : 0;
      resolve(proxyPort);
    });

    server.on("error", reject);
  });
}

export function stopProxy() {
  if (server) { server.close(); server = undefined; proxyPort = 0; }
}
