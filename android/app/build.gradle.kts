import java.util.Properties

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
  id("org.jetbrains.kotlin.plugin.serialization")
}

// Release signing lives OUTSIDE the repo. Point BURN_KEYSTORE_PROPS (or the Gradle property
// burn.keystoreProps) at a properties file with storeFile/storePassword/keyAlias/keyPassword.
val keystorePropsFile = ((findProperty("burn.keystoreProps") as String?) ?: System.getenv("BURN_KEYSTORE_PROPS"))?.let { file(it) }
val keystoreProps = Properties().apply { keystorePropsFile?.takeIf { it.exists() }?.inputStream()?.use { load(it) } }

// Where a fresh install points before the user changes it under Phone guard, Server.
// Default: the hosted server. For a local backend: -Pburn.backendUrl=http://localhost:8787 (or BURN_BACKEND_URL)
// together with `adb reverse tcp:8787 tcp:8787`, so Google sign-in sees the same localhost origin as the web app.
val defaultBackendUrl = (findProperty("burn.backendUrl") as String?)
  ?: System.getenv("BURN_BACKEND_URL")
  ?: "https://tubbybuddy-production.up.railway.app"

android {
  namespace = "app.burn.focus"
  compileSdk = 34

  defaultConfig {
    applicationId = "app.burn.focus"
    minSdk = 26
    targetSdk = 34
    versionCode = 7
    versionName = "0.7.0"
    buildConfigField("String", "DEFAULT_BACKEND_URL", "\"$defaultBackendUrl\"")
  }

  signingConfigs {
    if (keystoreProps.getProperty("storeFile") != null) {
      create("burn") {
        storeFile = file(keystoreProps.getProperty("storeFile"))
        storePassword = keystoreProps.getProperty("storePassword")
        keyAlias = keystoreProps.getProperty("keyAlias")
        keyPassword = keystoreProps.getProperty("keyPassword")
      }
    }
  }

  buildTypes {
    val burnSigning = signingConfigs.findByName("burn")
    debug {
      // Same key for debug + release so sideloaded updates install over each other.
      if (burnSigning != null) signingConfig = burnSigning
    }
    release {
      isMinifyEnabled = false
      if (burnSigning != null) signingConfig = burnSigning
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
  buildFeatures { compose = true; buildConfig = true }
  lint {
    abortOnError = true
    warningsAsErrors = false
    checkReleaseBuilds = false
    disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
  }
  testOptions { unitTests.isReturnDefaultValues = true }
  packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
  val bom = platform("androidx.compose:compose-bom:2024.10.01")
  implementation(bom)
  implementation("androidx.core:core-ktx:1.13.1")
  implementation("androidx.activity:activity-compose:1.9.3")
  implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
  implementation("androidx.lifecycle:lifecycle-service:2.8.7")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-graphics")
  implementation("androidx.compose.foundation:foundation")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.material:material-icons-core")
  implementation("androidx.compose.ui:ui-tooling-preview")
  debugImplementation("androidx.compose.ui:ui-tooling")
  implementation("androidx.datastore:datastore-preferences:1.1.1")
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

  testImplementation("junit:junit:4.13.2")
  testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}
