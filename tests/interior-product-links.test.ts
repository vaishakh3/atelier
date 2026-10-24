import {describe,expect,it} from 'vitest';
import {INTERIOR_STYLES} from '../src/interior/catalog';
import {checkedProductLink} from '../desktop/external-links';
describe('explicit external product links',()=>{
  it('permits HTTPS manufacturer and user initiated search links',()=>{
    expect(checkedProductLink('https://www.ikea.com/in/en/p/poaeng-armchair/')).toContain('ikea.com');
    expect(checkedProductLink('https://www.google.com/search?tbm=shop&q=oak%20chair')).toContain('tbm=shop');
    expect(checkedProductLink('https://lens.google.com/')).toBe('https://lens.google.com/');
  });
  it('opens researched theme sources and credited photo licence pages',()=>{for(const style of INTERIOR_STYLES){for(const source of style.sources)expect(checkedProductLink(source.url)).toBe(source.url);expect(checkedProductLink(style.image!.sourceUrl)).toBe(style.image!.sourceUrl);expect(checkedProductLink(style.image!.licenseUrl)).toBe(style.image!.licenseUrl);}});
  it('rejects schemes, credentials, lookalike hosts, private hosts and custom ports',()=>{
    for(const url of ['file:///etc/passwd','javascript:alert(1)','http://www.ikea.com/','https://www.ikea.com.evil.test/','https://user:pass@www.ikea.com/','https://127.0.0.1/','https://www.google.com:8443/','https://example.com/','atelier://app','https://www.google.com/'+ 'x'.repeat(2050)])expect(()=>checkedProductLink(url)).toThrow();
  });
});
