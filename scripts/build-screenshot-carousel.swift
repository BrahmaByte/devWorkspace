// Encode existing dashboard screenshots as a rotating GIF. No third-party runtime.
import Foundation
import ImageIO
import UniformTypeIdentifiers

let folder = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "assets/screenshots"
let directory = URL(fileURLWithPath: folder, isDirectory: true)
let names = ["home-light", "home-dark", "notes", "jira-reader", "knowledge", "settings"]
let output = directory.appendingPathComponent("carousel.gif")
guard let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.gif.identifier as CFString, names.count, nil) else {
    fatalError("Cannot create screenshot carousel")
}
CGImageDestinationSetProperties(destination, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
for name in names {
    guard let source = CGImageSourceCreateWithURL(directory.appendingPathComponent(name + ".png") as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fatalError("Missing screenshot: " + name) }
    CGImageDestinationAddImage(destination, image, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 5.0]] as CFDictionary)
}
guard CGImageDestinationFinalize(destination) else { fatalError("Could not encode screenshot carousel") }
print("Encoded six-frame carousel: " + output.path)
