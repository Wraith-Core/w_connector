import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './ctx';
import { useI18n } from './i18n';
import type { Catalog, PermKey, SelfState } from './types';
import Glyph from './ui/Glyph';
import type { GlyphName } from './ui/Glyph';
import CraftingFrame from './ui/CraftingFrame';
import { weatherLabel } from './tabs/Dashboard';

type Group = 'self' | 'players' | 'travel' | 'spawn' | 'vehicle' | 'dev' | 'world';
type Tool = { id:string; group:Group; icon:GlyphName; perm:PermKey; key?:keyof SelfState; args?:Record<string,unknown>; danger?:boolean; disabled?:boolean };
const GROUPS: {id:Group; icon:GlyphName; perm?:PermKey}[] = [
  {id:'self',icon:'self'}, {id:'players',icon:'players',perm:'players'}, {id:'travel',icon:'pin',perm:'teleport'},
  {id:'spawn',icon:'horse',perm:'spawn'}, {id:'vehicle',icon:'wagon',perm:'vehicle'}, {id:'dev',icon:'search'}, {id:'world',icon:'map',perm:'server'},
];

export default function QuickMenu({embedded=false,onClose,onFull}:{embedded?:boolean;onClose?:()=>void;onFull?:()=>void}) {
  const app=useApp(), {t,rtl}=useI18n();
  const [group,setGroup]=useState<Group>('self'), [search,setSearch]=useState(''), [busy,setBusy]=useState('');
  const [playerId,setPlayerId]=useState<number|null>(null), [model,setModel]=useState('');
  const [spawnKind,setSpawnKind]=useState<'horses'|'wagons'|'animals'|'peds'>('horses');
  const [mount,setMount]=useState(true), [behavior,setBehavior]=useState('stand');
  const [coords,setCoords]=useState({x:'',y:'',z:''}), [radius,setRadius]=useState(30);
  const [weather,setWeather]=useState('SUNNY'), [hour,setHour]=useState(12), [announcement,setAnnouncement]=useState('');
  const root=useRef<HTMLDivElement>(null);
  const current=app.players.find(p=>p.id===playerId);
  const groups=GROUPS.filter(g=>!g.perm||app.can(g.perm)).filter(g=>g.id!=='dev'||app.can('dev')||app.can('entities'));
  useEffect(()=>{if(!groups.some(g=>g.id===group))setGroup('self');},[app.perms,group]);
  useEffect(()=>{if(playerId&&app.playersSeen&&!current)setPlayerId(null);},[playerId,current,app.playersSeen]);
  const go=(value:Group)=>{setGroup(value);setSearch('');};
  const run=async(id:string,endpoint='self',args:Record<string,unknown>={})=>{
    if(busy)return {ok:false};
    setBusy(id);
    try{return await app.act(endpoint,endpoint==='player'?{id:playerId,action:id,args}:{action:id,args},{okText:t('ui_done')});}
    finally{setBusy('');}
  };
  const tools:Tool[]=[
    {id:'noclip',group:'self',icon:'arrow',perm:'teleport',key:'noclip'},
    {id:'invisible',group:'self',icon:'self',perm:'players',key:'invisible'},
    {id:'godmode',group:'self',icon:'lock',perm:'revive',key:'godmode'},
    {id:'names',group:'self',icon:'players',perm:'players',key:'names'},
    {id:'boost',group:'self',icon:'bolt',perm:'revive',key:'boost'},
    {id:'stamina',group:'self',icon:'heart',perm:'revive',key:'stamina'},
    {id:'heal',group:'self',icon:'heart',perm:'revive'},
    {id:'revive',group:'self',icon:'refresh',perm:'revive'},
    {id:'cleanPed',group:'self',icon:'water',perm:'revive'},
    {id:'tpWaypoint',group:'travel',icon:'pin',perm:'teleport'},
    {id:'tpBack',group:'travel',icon:'refresh',perm:'teleport',disabled:!app.self?.canGoBack},
    {id:'tpForward',group:'travel',icon:'arrow',perm:'teleport'},
    {id:'repairVehicle',group:'vehicle',icon:'wagon',perm:'vehicle'},
    {id:'flipVehicle',group:'vehicle',icon:'refresh',perm:'vehicle'},
    {id:'vehicleBoost',group:'vehicle',icon:'bolt',perm:'vehicle'},
    {id:'healMount',group:'vehicle',icon:'horse',perm:'vehicle'},
    {id:'deleteVehicle',group:'vehicle',icon:'close',perm:'entities',danger:true},
    {id:'laser',group:'dev',icon:'search',perm:'entities',key:'laser'},
    {id:'showCoords',group:'dev',icon:'pin',perm:'dev',key:'showCoords'},
    {id:'hashes',group:'dev',icon:'search',perm:'dev',key:'hashes'},
    {id:'copyCoords3',group:'dev',icon:'map',perm:'dev',args:{type:'coords3'}},
    {id:'copyCoords4',group:'dev',icon:'map',perm:'dev',args:{type:'coords4'}},
    {id:'copyHeading',group:'dev',icon:'arrow',perm:'dev',args:{type:'heading'}},
  ];
  const label=(id:string)=>t('quick_'+id);
  const actionId=(id:string)=>id.startsWith('copy')?'copyCoords':id;
  const choose=(tool:Tool)=>{
    const args=tool.key?{state:!app.self?.[tool.key]}:tool.args||{};
    if(tool.danger){app.confirm({title:label(tool.id),text:t('quick_delete_confirm'),danger:true,onConfirm:async()=>{return (await run(actionId(tool.id),'self',args)).ok;}});return;}
    void run(actionId(tool.id),'self',args);
  };
  const needle=search.trim().toLocaleLowerCase();
  const shown=tools.filter(tool=>app.can(tool.perm)&&(needle?`${label(tool.id)} ${tool.id}`.toLocaleLowerCase().includes(needle):tool.group===group));
  const modelRows=useMemo(()=>((app.catalog?.[spawnKind]||[]) as Catalog['horses']).filter(row=>`${row.label} ${row.model}`.toLocaleLowerCase().includes(needle)),[app.catalog,spawnKind,needle]);
  // the citizen id is what staff type everywhere else, so it is searchable and shown here too
  const filteredPlayers=app.players.filter(p=>`#${p.id} ${p.citizenid??''} ${p.name} ${p.firstname} ${p.lastname}`.toLocaleLowerCase().includes(needle));
  const active=tools.filter(tool=>tool.key&&app.self?.[tool.key]===true);
  const row=(tool:Tool)=><button type="button" key={tool.id} className={'qa-row wst-card'+(tool.key&&app.self?.[tool.key]?' active':'')+(tool.danger?' danger':'')}
    disabled={!!busy||tool.disabled} aria-pressed={tool.key?!!app.self?.[tool.key]:undefined} onClick={()=>choose(tool)}>
    <Glyph name={tool.icon}/><span className="qa-row-label">{label(tool.id)}<small>{t('quick_hint_'+tool.id)}</small></span>
    {busy===actionId(tool.id)?<span className="qa-working">…</span>:tool.key?<span className="qa-switch"><i/></span>:<Glyph name="arrow"/>}
  </button>;
  const actionButton=(id:string,fn:()=>void,disabled=false)=><button key={id} className="qa-button wst-button" type="button" disabled={!!busy||disabled} onClick={fn}>{busy===id?'…':label(id)}</button>;
  const keyboard=(e:React.KeyboardEvent)=>{
    if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
    if((e.target as HTMLElement).matches('input[type=number],select,textarea'))return;
    const buttons=Array.from(root.current?.querySelectorAll<HTMLButtonElement>('.qa-row:not(:disabled)')||[]);
    if(!buttons.length)return;
    const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next=index<0?0:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
    e.preventDefault();buttons[next].focus();buttons[next].scrollIntoView({block:'nearest'});
  };
  return <div className={'qa-root wst-root '+(embedded?'qa-embedded':'qa-floating wst-panel')+(rtl?' is-rtl':'')} ref={root} onKeyDown={keyboard}>
    {!embedded&&<CraftingFrame/>}
    <header className="qa-header wst-header"><div className="qa-brand">W</div><div><span>WRAITH ADMIN</span><h2>{t('quick_title')}</h2><small>{app.admin?.name} <bdi>#{app.selfId}</bdi></small></div>
      {!embedded&&<button className="qa-close wst-close" type="button" aria-label={t('ui_close')} onClick={onClose}><Glyph name="close"/></button>}
      {embedded&&<span className="qa-header-hint"><kbd>PgUp</kbd>{t('quick_open_hint')}</span>}
    </header>
    <div className="qa-search wst-field"><Glyph name="search"/><input aria-label={t('quick_search')} placeholder={t(group==='spawn'?'quick_search_models':group==='players'?'quick_search_players':'quick_search')} value={search} onChange={e=>setSearch(e.target.value)} />{search&&<button type="button" aria-label={t('ui_clear')} onClick={()=>setSearch('')}>×</button>}</div>
    <nav className="qa-groups" aria-label={t('quick_categories')}>{groups.map(g=><button type="button" key={g.id} className={'wst-tab '+(group===g.id?'selected':'')} onClick={()=>go(g.id)}><Glyph name={g.icon}/><span>{t('quick_group_'+g.id)}</span></button>)}</nav>
    {!!app.self?.spectating&&<div className="qa-spectate"><Glyph name="players"/><span>{t('quick_watching')} <bdi>#{app.self.spectating}</bdi></span>{actionButton('stopSpectate',()=>void run('stopSpectate'))}</div>}
    <div className="qa-content">
      {(group!=='players'&&group!=='spawn'&&group!=='world'||needle&&group!=='players'&&group!=='spawn')&&<div className="qa-tools">{shown.map(row)}{!shown.length&&<p className="qa-empty">{t('quick_no_results')}</p>}</div>}
      {group==='self'&&!needle&&<div className="qa-box wst-plate"><label>{t('quick_noclipSpeed')}<select value={app.self?.noclipSpeed||1} disabled={!!busy||!app.can('teleport')} onChange={e=>void run('noclipSpeed','self',{speed:Number(e.target.value)})}>{[.25,.5,1,2,5,10].map(n=><option value={n} key={n}>{n}×</option>)}</select></label>
        {app.can('needs')&&actionButton('refill',()=>{setBusy('refill');void app.act('player',{id:app.selfId,action:'needs',args:{hunger:100,thirst:100}},{okText:t('ui_done')}).finally(()=>setBusy(''));})}</div>}
      {group==='travel'&&!needle&&<div className="qa-box wst-plate"><h3>{t('quick_tpCoords')}</h3><div className="qa-coordinate-fields">{(['x','y','z'] as const).map(axis=><label key={axis}>{axis.toUpperCase()}<input type="number" step="any" value={coords[axis]} onChange={e=>setCoords({...coords,[axis]:e.target.value})}/></label>)}</div>{actionButton('tpCoords',()=>void run('tpCoords','self',{x:Number(coords.x),y:Number(coords.y),...(coords.z.trim()?{z:Number(coords.z)}:{})}),!coords.x.trim()||!coords.y.trim())}<small>{t('quick_ground_hint')}</small></div>}
      {group==='players'&&<div className="qa-player-section"><div className="qa-player-list">{filteredPlayers.map(p=><button type="button" key={p.id} className={'qa-player wst-card'+(p.id===playerId?' selected':'')} onClick={()=>setPlayerId(p.id)}><bdi>#{p.id}</bdi><span>{p.name}<small>{p.firstname} {p.lastname}{p.citizenid?<> · <bdi dir="ltr">{p.citizenid}</bdi></>:null}</small></span><small>{p.ping} ms</small>{p.dead&&<Glyph name="skull"/>}</button>)}{!filteredPlayers.length&&<p className="qa-empty">{t('quick_no_results')}</p>}</div>
        {current?<div className="qa-box wst-plate"><h3>{current.name} <bdi>#{current.id}</bdi></h3><div className="qa-player-actions">{[
          ['teleportTo','teleport'],['bring','teleport'],['bringBack','teleport'],['spectate','players'],['freeze','players'],['revive','revive'],['heal','revive'],['openInventory','items'],['wardrobe','items'],
        ].filter(([,perm])=>app.can(perm as PermKey)).map(([id])=>actionButton(id,()=>void run(id,'player',id==='spectate'?{state:true}:id==='freeze'?{state:!current.frozen}:{}),
          (current.id===app.selfId&&['teleportTo','bring','bringBack','spectate','freeze'].includes(id))||(id==='bringBack'&&!current.canReturn)))}
        </div><small>{current.frozen?t('quick_player_frozen'):t('quick_player_hint')}</small></div>:<p className="qa-empty">{t('quick_pick_player')}</p>}</div>}
      {group==='spawn'&&<><div className="qa-spawn-kinds">{(['horses','wagons','animals','peds'] as const).map(kind=><button type="button" key={kind} className={'wst-tab '+(spawnKind===kind?'selected':'')} onClick={()=>{setSpawnKind(kind);setModel('');setSearch('');}}>{t('quick_'+kind)}</button>)}</div>
        <div className="qa-model-list">{modelRows.map(row=><button type="button" key={row.model} className={'qa-model wst-card'+(model===row.model?' selected':'')} onClick={()=>setModel(row.model)}><span>{row.label}</span><code>{row.model}</code>{model===row.model&&<Glyph name="check"/>}</button>)}{!modelRows.length&&<p className="qa-empty">{t('quick_no_results')}</p>}</div>
        <div className="qa-box wst-plate"><small>{t('quick_model_count',modelRows.length)} · {t('quick_temporary')}</small><code className="qa-chosen">{model||t('quick_pick_model')}</code>
          {spawnKind==='horses'||spawnKind==='wagons'?<label className="qa-check"><input type="checkbox" checked={mount} onChange={e=>setMount(e.target.checked)}/>{t('quick_mount_after')}</label>:<label>{t('quick_behavior')}<select value={behavior} onChange={e=>setBehavior(e.target.value)}><option value="stand">{t('quick_stand')}</option><option value="wander">{t('quick_wander')}</option></select></label>}
          {actionButton('spawn',()=>void run(({horses:'spawnHorse',wagons:'spawnWagon',animals:'spawnAnimal',peds:'spawnPed'})[spawnKind],'self',{model,mount,behavior}),!model)}
          {actionButton('cleanupSpawned',()=>app.confirm({title:t('quick_cleanupSpawned'),text:t('quick_cleanup_hint'),onConfirm:async()=>{return (await run('cleanupSpawned')).ok;}}))}
          <small>{t('quick_spawned_count',app.self?.spawnedCount||0)}</small></div></>}
      {group==='dev'&&!needle&&app.can('entities')&&<div className="qa-box wst-plate"><h3>{t('quick_clearArea')}</h3><label>{t('ui_self_radius')}<input type="number" min="5" max="100" value={radius} onChange={e=>setRadius(Number(e.target.value))}/></label>{actionButton('clearArea',()=>app.confirm({title:t('quick_clearArea'),danger:true,text:t('quick_clear_confirm',radius),onConfirm:async()=>{return (await run('clearArea','self',{radius})).ok;}}),radius<5||radius>100)}<small>{t('quick_laser_note')}</small></div>}
      {group==='world'&&!needle&&<div className="qa-world"><div className="qa-box wst-plate"><h3>{t('ui_dash_set_weather')}</h3><select aria-label={t('ui_dash_weather')} value={weather} onChange={e=>setWeather(e.target.value)}>{(app.catalog?.weathers||[]).map(w=><option key={w} value={w}>{weatherLabel(t,w)}</option>)}</select>{actionButton('weather',()=>void run('weather','server',{type:weather}))}</div><div className="qa-box wst-plate"><label>{t('ui_dash_hour')}<input type="number" min="0" max="23" value={hour} onChange={e=>setHour(Number(e.target.value))}/></label>{actionButton('time',()=>void run('time','server',{hour,minute:0}),hour<0||hour>23)}</div><div className="qa-box wst-plate"><h3>{t('ui_dash_announce')}</h3><textarea aria-label={t('ui_dash_announce')} value={announcement} maxLength={300} rows={3} onChange={e=>setAnnouncement(e.target.value)}/>{actionButton('announce',()=>void run('announce','server',{text:announcement}),!announcement.trim())}</div></div>}
    </div>
    <footer className="qa-footer"><div className="qa-active">{active.length?<><i/>{t('quick_active_count',active.length)}</>:t('quick_ready')}<span><bdi>#{app.selfId}</bdi> · {app.admin?.group}</span></div>
      {!embedded&&<button type="button" className="qa-full wst-button primary" onClick={onFull}><Glyph name="dashboard"/>{t('quick_full')}<kbd>F10</kbd></button>}
      <div className="qa-key-hints"><span>↑ ↓ <small>{t('quick_navigate')}</small></span><span>↵ <small>{t('quick_select')}</small></span><span>ESC / PgUp <small>{t('ui_close')}</small></span></div>
    </footer>
  </div>;
}
