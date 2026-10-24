// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import ThemePicker,{ThemePhoto} from '../src/components/ThemePicker';
import {INTERIOR_STYLES} from '../src/interior/catalog';
const links=vi.hoisted(()=>({open:vi.fn(async()=>{})}));
vi.mock('../src/domain/desktop',()=>({openProductLink:links.open}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe('curated interior theme picker',()=>{
 it('searches all curated styles and previews a direction without applying it until Use theme',()=>{
  const onSelect=vi.fn(),onClose=vi.fn();render(<ThemePicker selectedStyleId="japandi" canEdit onSelect={onSelect} onClose={onClose}/>);expect(screen.getAllByRole('button',{name:/^Preview .* theme$/})).toHaveLength(INTERIOR_STYLES.length);expect(onSelect).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox',{name:'Search interior themes'}),{target:{value:'Kerala'}});expect(screen.getAllByRole('button',{name:/^Preview .* theme$/})).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Preview Kerala Contemporary theme'}));const details=screen.getByRole('complementary',{name:'Theme preview details'});expect(within(details).getByText('Kerala Contemporary',{exact:true})).toBeTruthy();expect(details.textContent).toContain('not a compliance check');expect(details.textContent).toContain('Terracotta-toned finish');expect(onSelect).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Use Kerala Contemporary theme'}));expect(onSelect).toHaveBeenCalledExactlyOnceWith('kerala-contemporary');
 });
 it('lets viewers browse and recover from an empty search while keeping theme changes disabled',()=>{
  const onSelect=vi.fn();render(<ThemePicker selectedStyleId="modern" canEdit={false} onSelect={onSelect} onClose={vi.fn()}/>);fireEvent.change(screen.getByRole('textbox',{name:'Search interior themes'}),{target:{value:'nothing-like-this-123'}});expect(screen.getByText('No themes match “nothing-like-this-123”.')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Show all themes'}));expect(screen.getAllByRole('button',{name:/^Preview .* theme$/})).toHaveLength(INTERIOR_STYLES.length);fireEvent.click(screen.getByRole('button',{name:'Preview Coastal theme'}));expect(screen.getByRole('button',{name:'Use Coastal theme'}).hasAttribute('disabled')).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Use Coastal theme'}));expect(onSelect).not.toHaveBeenCalled();
 });
 it('shows photo attribution, original and licence links alongside materials and lighting',()=>{
  const style=INTERIOR_STYLES.find(s=>s.id==='japandi')!,previous=style.image;style.image={src:'/interior-themes/japandi.jpg',alt:'Japandi mood photograph',credit:'Reference photographer / Unsplash',sourceUrl:'https://unsplash.com/photos/reference-photo',licenseUrl:'https://unsplash.com/license'};
  try{render(<ThemePicker selectedStyleId="japandi" canEdit onSelect={vi.fn()} onClose={vi.fn()}/>);const details=screen.getByRole('complementary',{name:'Theme preview details'});expect(within(details).getByAltText('Japandi mood photograph').getAttribute('src')).toBe(style.image.src);expect(within(details).getByText(style.image.credit)).toBeTruthy();for(const material of style.materials)expect(within(details).getByText(material,{exact:true})).toBeTruthy();expect(within(details).getByText(style.lighting)).toBeTruthy();fireEvent.click(within(details).getByRole('button',{name:'View original'}));expect(links.open).toHaveBeenCalledWith(style.image.sourceUrl);fireEvent.click(within(details).getByRole('button',{name:'Photo licence'}));expect(links.open).toHaveBeenCalledWith(style.image.licenseUrl);expect(details.textContent).toContain('products pictured are not the source-linked furniture catalogue');}finally{style.image=previous;}
 });
 it('tries a new photo source after an earlier theme image failed',()=>{
  const source=INTERIOR_STYLES[0],image={src:'/missing-theme.jpg',alt:'Theme image',credit:'Photographer',sourceUrl:'https://unsplash.com/photos/example',licenseUrl:'https://unsplash.com/license'},view=render(<ThemePhoto style={{...source,image}}/>);fireEvent.error(screen.getByAltText('Theme image'));expect(screen.queryByAltText('Theme image')).toBeNull();view.rerender(<ThemePhoto style={{...source,image:{...image,src:'/interior-themes/new-source.jpg'}}}/>);expect(screen.getByAltText('Theme image').getAttribute('src')).toBe('/interior-themes/new-source.jpg');
 });
 it('closes on Escape without applying a previewed theme',()=>{
  const onSelect=vi.fn(),onClose=vi.fn();render(<ThemePicker selectedStyleId="japandi" canEdit onSelect={onSelect} onClose={onClose}/>);fireEvent.click(screen.getByRole('button',{name:'Preview Industrial theme'}));fireEvent.keyDown(screen.getByRole('dialog',{name:'Find your interior direction'}),{key:'Escape'});expect(onClose).toHaveBeenCalledOnce();expect(onSelect).not.toHaveBeenCalled();
 });
});
