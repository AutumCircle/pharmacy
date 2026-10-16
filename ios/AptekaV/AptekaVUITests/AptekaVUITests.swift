//
//  AptekaVUITests.swift
//  AptekaVUITests
//
//  Created by Developer on 12/10/26.
//

import XCTest

final class AptekaVUITests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.

        // In UI tests it is usually best to stop immediately when a failure occurs.
        continueAfterFailure = false

        // In UI tests it’s important to set the initial state - such as interface orientation - required for your tests before they run. The setUp method is a good place to do this.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }

    /// «Профиль» → «Войти» → phone → «Получить код» → test code 12345 → signed in.
    func testSignInWithTestCode() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-auth.phone", ""]
        app.launch()

        app.buttons["Профиль"].tap()
        let signIn = app.buttons["profile.signIn"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 5))
        signIn.tap()

        let phone = app.textFields["login.phone"]
        XCTAssertTrue(phone.waitForExistence(timeout: 5))
        phone.tap()
        phone.typeText("931234567")
        app.buttons["login.sendCode"].tap()

        let code = app.textFields["login.code"]
        XCTAssertTrue(code.waitForExistence(timeout: 5))
        code.tap()
        code.typeText("12345")

        XCTAssertTrue(app.staticTexts["+992 93 123 45 67"].waitForExistence(timeout: 8))
    }

    func testExample() throws {
        // UI tests must launch the application that they test.
        let app = XCUIApplication()
        app.launch()

        // Use XCTAssert and related functions to verify your tests produce the correct results.
    }

    func testLaunchPerformance() throws {
        if #available(macOS 10.15, iOS 13.0, tvOS 13.0, watchOS 7.0, *) {
            // This measures how long it takes to launch your application.
            measure(metrics: [XCTApplicationLaunchMetric()]) {
                XCUIApplication().launch()
            }
        }
    }
}
