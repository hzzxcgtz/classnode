export function ImageZoomSlider({zoom,onChange}:{zoom:number;onChange:(zoom:number)=>void}) {
 return <div style={{display:'inline-flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:0,minWidth:60,width:'clamp(60px, 10vw, 130px)',flexShrink:1}}>
  <output aria-label="图片缩放比例" style={{flex:'0 0 auto',fontSize:11,lineHeight:'14px',padding:0}}>{Math.round(zoom*100)}%</output>
  <input type="range" aria-label="图片缩放" min={30} max={1500} step={10} value={Math.round(zoom*100)} onChange={event=>onChange(Number(event.target.value)/100)} style={{flex:'0 0 auto',width:'100%',margin:0}}/>
 </div>;
}
