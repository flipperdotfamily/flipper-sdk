import org.gradle.api.publish.maven.tasks.PublishToMavenRepository
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.concurrent.Callable

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    `maven-publish`
    signing
}

group = providers.gradleProperty("GROUP").getOrElse("family.flipper")
version = providers.gradleProperty("VERSION_NAME").getOrElse("0.1.0")

val isSnapshot = version.toString().endsWith("SNAPSHOT")

/** Gradle property first (~/.gradle/gradle.properties or ORG_GRADLE_PROJECT_<name>), then a plain env var. */
fun secret(property: String, env: String): String? =
    providers.gradleProperty(property).orElse(providers.environmentVariable(env)).orNull?.takeIf { it.isNotBlank() }

android {
    namespace = "family.flipper.widget"
    compileSdk = 35

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = false
    }

    sourceSets {
        getByName("main") { java.srcDir("src/main/kotlin") }
        getByName("test") { java.srcDir("src/test/kotlin") }
    }

    publishing {
        singleVariant("release") {
            withSourcesJar()
            withJavadocJar()
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        // Interface default methods (FlipperWidgetListener) become real Java defaults for Java callers.
        freeCompilerArgs.add("-Xjvm-default=all")
    }
}

dependencies {
    api(libs.kotlinx.coroutines.core)
    api(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.lifecycle.runtime)

    // The Compose API (FlipperWidget) is part of this artifact; Modifier is in its public signature.
    api(platform(libs.compose.bom))
    api(libs.compose.runtime)
    api(libs.compose.ui)
    implementation(libs.compose.foundation.layout)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}

publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = project.group.toString()
            artifactId = "widget"
            version = project.version.toString()

            // AGP creates the "release" software component during afterEvaluate.
            afterEvaluate {
                from(components["release"])
            }

            pom {
                name.set("flipper.family widget for Android")
                description.set(
                    "Drop-in, white-label flipper.family coin-flip widget for Android Views and Jetpack Compose. " +
                        "Loads the hosted embed in a hardened WebView and routes its wallet requests to the host app's wallet.",
                )
                url.set("https://flipper.family")
                inceptionYear.set("2026")
                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://opensource.org/licenses/MIT")
                        distribution.set("repo")
                    }
                }
                developers {
                    developer {
                        id.set("flipperdotfamily")
                        name.set("flipper.family")
                        url.set("https://flipper.family")
                    }
                }
                scm {
                    // PLACEHOLDER: replace with the real public repository before the first release.
                    url.set("https://github.com/flipperdotfamily/flipper-sdk")
                    connection.set("scm:git:https://github.com/flipperdotfamily/flipper-sdk.git")
                    developerConnection.set("scm:git:ssh://git@github.com/flipperdotfamily/flipper-sdk.git")
                }
            }
        }
    }

    repositories {
        // 1) Local staging directory: zip it and upload the bundle to the Central Portal (see README).
        maven {
            name = "stagingDeploy"
            url = uri(layout.buildDirectory.dir("staging-deploy"))
        }
        // 2) Central Portal's OSSRH Staging API compatibility endpoint (legacy OSSRH was shut down in 2025).
        //    After `publish...ToCentralPortalRepository`, POST /manual/upload/defaultRepository/family.flipper
        //    from the same machine / IP so the deployment shows up in the Portal (see README).
        maven {
            name = "centralPortal"
            url = uri("https://ossrh-staging-api.central.sonatype.com/service/local/staging/deploy/maven2/")
            credentials {
                username = secret("mavenCentralUsername", "MAVEN_CENTRAL_USERNAME")
                password = secret("mavenCentralPassword", "MAVEN_CENTRAL_PASSWORD")
            }
        }
    }
}

signing {
    val signingKey = secret("signingInMemoryKey", "SIGNING_KEY")
    val signingPassword = secret("signingInMemoryKeyPassword", "SIGNING_PASSWORD")
    val signingKeyId = secret("signingInMemoryKeyId", "SIGNING_KEY_ID")
    if (signingKey != null) {
        if (signingKeyId != null) {
            useInMemoryPgpKeys(signingKeyId, signingKey, signingPassword)
        } else {
            useInMemoryPgpKeys(signingKey, signingPassword)
        }
    }
    // Required only for a release version going to a Maven repository (not for SNAPSHOTs or publishToMavenLocal).
    setRequired(
        Callable {
            !isSnapshot && gradle.taskGraph.allTasks.any { it is PublishToMavenRepository }
        },
    )
    sign(publishing.publications)
}
