// 3.8.0-dev.4: export_pdf prints a temporary copy. Images are sized to the
// page, the title is written into the copy, and page breaks go into the copy
// only. These tests run against the layout estimate, not a real print.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {fitImages,imageDimensions,imageEmbeds,prepareExportCopy} from '../src/pdf-export-copy';
import {OWLA_PAGE_BREAK,pageContentBox,type PdfExportOptions} from '../src/pdf-export';

const A4:PdfExportOptions={pageSize:'A4',landscape:false,margin:'default',downscalePercent:100,includeName:false,open:false};

function png(width:number,height:number){const b=new Uint8Array(24);b.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],0);const v=new DataView(b.buffer);v.setUint32(16,width);v.setUint32(20,height);return b;}
function jpeg(width:number,height:number,orientation?:number){
 const parts:number[]=[0xff,0xd8];
 if(orientation){
  // APP1 Exif, big-endian TIFF with one IFD0 entry: Orientation (0x0112), SHORT, 1, value.
  const tiff=[0x4d,0x4d,0x00,0x2a,0,0,0,8,0,1,0x01,0x12,0,3,0,0,0,1,0,orientation,0,0,0,0,0,0];
  const payload=[0x45,0x78,0x69,0x66,0,0,...tiff];
  parts.push(0xff,0xe1,((payload.length+2)>>8)&0xff,(payload.length+2)&0xff,...payload);
 }
 parts.push(0xff,0xc0,0,17,8,(height>>8)&0xff,height&0xff,(width>>8)&0xff,width&0xff,3,1,0x22,0,2,0x11,1,3,0x11,1);
 return new Uint8Array(parts);
}

test('image sizes are read from PNG, GIF, JPEG (with EXIF rotation), WebP and BMP headers',()=>{
 assert.deepEqual(imageDimensions(png(1200,800)),{width:1200,height:800});
 assert.deepEqual(imageDimensions(new Uint8Array([0x47,0x49,0x46,0x38,0x39,0x61,0x40,0x01,0xf0,0x00])),{width:320,height:240});
 assert.deepEqual(imageDimensions(jpeg(4000,3000)),{width:4000,height:3000});
 assert.deepEqual(imageDimensions(jpeg(4000,3000,6)),{width:3000,height:4000},'orientation 6 is a portrait photo');
 const vp8x=new Uint8Array(30);vp8x.set([...'RIFF'].map(c=>c.charCodeAt(0)),0);vp8x.set([...'WEBPVP8X'].map(c=>c.charCodeAt(0)),8);vp8x.set([0x7f,0x07,0x00],24);vp8x.set([0x37,0x04,0x00],27);
 assert.deepEqual(imageDimensions(vp8x),{width:1920,height:1080});
 const bmp=new Uint8Array(26);bmp.set([0x42,0x4d],0);new DataView(bmp.buffer).setInt32(18,640,true);new DataView(bmp.buffer).setInt32(22,-480,true);
 assert.deepEqual(imageDimensions(bmp),{width:640,height:480});
 assert.equal(imageDimensions(new TextEncoder().encode('<svg/>')),null);
 assert.equal(imageDimensions(new Uint8Array(0)),null);
});

test('image embeds: wiki and Markdown forms, sizes, tables; captions, notes and web images are left alone',()=>{
 assert.deepEqual(imageEmbeds('![[a.png]] and ![[b.jpg|300]] and ![[c.png|200x100]]').map(e=>[e.target,e.width,e.height]),[['a.png',undefined,undefined],['b.jpg',300,undefined],['c.png',200,100]]);
 assert.deepEqual(imageEmbeds('![[Note]] ![[doc.pdf]] ![[a.png|Figure 1]] ![](https://x.org/a.png)'),[]);
 assert.deepEqual(imageEmbeds('![alt|400](img/My%20Pic.png)').map(e=>[e.target,e.width]),[['img/My Pic.png',400]]);
 assert.equal(imageEmbeds('| ![[a.png\\|300]] |',true)[0].rewrite(200),'![[a.png\\|200]]','table rows keep the escaped pipe');
});

test('images wider or taller than the page are sized down with their aspect ratio; small ones are never enlarged',()=>{
 const box=pageContentBox(A4);
 const sizes:Record<string,{width:number;height:number}>={'wide.png':{width:3000,height:1000},'tall.png':{width:800,height:4000},'small.png':{width:200,height:100}};
 const text='# T\n\n![[wide.png]]\n\n![[tall.png]]\n\n![[small.png]]\n\n![big|2000](unknown.png)\n\n```\n![[wide.png]]\n```\n';
 const result=fitImages(text,box,target=>sizes[target]??null);
 const lines=result.text.split('\n');
 assert.equal(lines[2],'![[wide.png|'+box.width+']]','capped to the content width');
 const tall=Number(/\|(\d+)\]\]/.exec(lines[4])?.[1]);
 assert.ok(tall*5<=box.height+5&&tall<box.width,'capped so the height fits one page');
 assert.equal(lines[6],'![[small.png]]','a small image is unchanged');
 assert.equal(lines[8],'![big|'+box.width+'](unknown.png)','a written width that is too wide is capped even without the pixel size');
 assert.equal(lines[11],'![[wide.png]]','code blocks are never edited');
 assert.equal(result.fitted.length,3);
});

test('the export copy: title written in, not duplicated, image under the title shrunk, breaks only in the copy',()=>{
 const sizeOf=(target:string)=>target==='photo.png'?{width:1000,height:1600}:null;
 const note='---\ntags: [x]\n---\nIntro.\n';
 const titled=prepareExportCopy({text:note,basename:'Biology Summary',options:{...A4,includeName:true},sizeOf});
 assert.equal(titled.options.includeName,false,'the copy\'s own file name is never printed');
 assert.equal(titled.title,'Biology Summary');
 assert.equal(titled.text,'---\ntags: [x]\n---\n# Biology Summary\n\nIntro.\n','the title goes below the properties');
 const own=prepareExportCopy({text:'# Biology Summary\n\nIntro.\n',basename:'Biology Summary',options:{...A4,includeName:true},sizeOf});
 assert.equal(own.text,'# Biology Summary\n\nIntro.\n','an identical first heading is not repeated');
 assert.match(own.changes.join(' '),/kept the note’s own first heading/);
 // A tall first image under the title would move to page 2 and leave the title alone.
 const lone=prepareExportCopy({text:'# Cells\n\n![[photo.png]]\n\nText.\n',basename:'Cells',options:A4,sizeOf});
 assert.match(lone.changes.join(' '),/first image smaller so it fits on page 1/);
 assert.ok(!lone.remaining.some(issue=>issue.kind==='title-alone'),'no lone title remains in the estimate');
 // A stranded heading gets a break in the copy; requested headings too.
 const filler=Array.from({length:25},(_,i)=>'Paragraph '+i+' '+'word '.repeat(3)).join('\n\n');
 const long='# Long\n\n'+filler+'\n\n## Stranded\n\nTail text.\n\n## Appendix\n\nMore.\n';
 const copy=prepareExportCopy({text:long,basename:'Long',options:{...A4,margin:'minimal'},breaksBefore:['Appendix','Nope'],sizeOf});
 assert.ok(copy.text.includes(OWLA_PAGE_BREAK+'\n\n## Stranded'));
 assert.ok(copy.text.includes(OWLA_PAGE_BREAK+'\n\n## Appendix'));
 assert.deepEqual(copy.unknownHeadings,['Nope']);
 assert.equal(copy.text.replaceAll(OWLA_PAGE_BREAK+'\n\n',''),long,'only break markers differ from the note');
 assert.ok(copy.remaining.every(issue=>issue.kind!=='orphan-heading'));
});
