import AppKit
import Foundation

let output = CommandLine.arguments[1]
try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
let sizes: [(String, Int)] = [("icon_16x16.png",16),("icon_16x16@2x.png",32),("icon_32x32.png",32),("icon_32x32@2x.png",64),("icon_128x128.png",128),("icon_128x128@2x.png",256),("icon_256x256.png",256),("icon_256x256@2x.png",512),("icon_512x512.png",512),("icon_512x512@2x.png",1024)]
for (name, size) in sizes {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:size,pixelsHigh:size,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0), let context = NSGraphicsContext(bitmapImageRep:bitmap) else { fatalError("Cannot render application icon") }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.cgContext.scaleBy(x:CGFloat(size)/1024,y:CGFloat(size)/1024)
    let tile = NSBezierPath(roundedRect:NSRect(x:52,y:52,width:920,height:920),xRadius:205,yRadius:205)
    NSGradient(starting:NSColor(calibratedRed:0.42,green:0.35,blue:0.75,alpha:1),ending:NSColor(calibratedRed:0.19,green:0.16,blue:0.34,alpha:1))!.draw(in:tile,angle:90)
    NSColor(calibratedWhite:1,alpha:0.07).setStroke()
    for i in 0...5 {let line=NSBezierPath();line.move(to:NSPoint(x:174+i*135,y:176));line.line(to:NSPoint(x:174+i*135,y:848));line.lineWidth=2;line.stroke()}
    let shape=NSBezierPath()
    shape.move(to:NSPoint(x:235,y:250));shape.line(to:NSPoint(x:449,y:772));shape.line(to:NSPoint(x:575,y:772));shape.line(to:NSPoint(x:789,y:250));shape.line(to:NSPoint(x:660,y:250));shape.line(to:NSPoint(x:620,y:360));shape.line(to:NSPoint(x:403,y:360));shape.line(to:NSPoint(x:364,y:250));shape.close()
    NSColor(calibratedRed:0.96,green:0.95,blue:0.91,alpha:1).setFill();shape.fill()
    let void=NSBezierPath();void.move(to:NSPoint(x:443,y:466));void.line(to:NSPoint(x:512,y:653));void.line(to:NSPoint(x:581,y:466));void.close()
    NSColor(calibratedRed:0.34,green:0.28,blue:0.58,alpha:1).setFill();void.fill()
    let line=NSBezierPath();line.move(to:NSPoint(x:235,y:208));line.line(to:NSPoint(x:789,y:208));line.lineWidth=7;NSColor(calibratedWhite:1,alpha:0.4).setStroke();line.stroke()
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using:.png,properties:[:]) else { fatalError("Cannot encode application icon") }
    try png.write(to:URL(fileURLWithPath:output).appendingPathComponent(name))
}
